#!/usr/bin/env bash
# Fuzz the HTTP API with schemathesis against a throwaway Postgres.
#
#   api/fuzz/run.sh [--empty] [-- <extra schemathesis args>]
#
# Without POSTGRES_URL it starts a local TLS-enabled cluster from the Postgres server binaries
# (PG_BIN, or the newest /usr/lib/postgresql/*/bin). With POSTGRES_URL (or TEST_POSTGRES_URL)
# it creates a scratch database on that server instead; set PG_SSLROOTCERT to the server's
# root certificate. Either way the migrations are applied and seed.sql is loaded (skipped with
# --empty, which exercises the empty-table behaviour).
#
# Environment: FUZZ_WORKDIR, FUZZ_PG_PORT (54329), FUZZ_API_PORT (8000), API_BIN, FUZZ_KEEP=1,
# SCHEMATHESIS_VERSION.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCHEMATHESIS_VERSION="${SCHEMATHESIS_VERSION:-4.33.4}"
PG_PORT="${FUZZ_PG_PORT:-54329}"
API_PORT="${FUZZ_API_PORT:-8000}"
SEED=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --empty) SEED=0; shift ;;
    --) shift; break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

WORK="${FUZZ_WORKDIR:-$(mktemp -d)}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
chmod 755 "$WORK"
API_PID=""
PG_STARTED=0
SCRATCH_DB=""
ADMIN_URL=""
RUN_AS=()

cleanup() {
  local status=$?
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  if [[ -n "$SCRATCH_DB" && -z "${FUZZ_KEEP:-}" ]]; then
    psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" || true
  fi
  if [[ "$PG_STARTED" == 1 ]]; then
    "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/pgdata" -m fast stop >/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

if [[ -n "${POSTGRES_URL:-${TEST_POSTGRES_URL:-}}" ]]; then
  ADMIN_URL="${POSTGRES_URL:-$TEST_POSTGRES_URL}"
  : "${PG_SSLROOTCERT:?set PG_SSLROOTCERT to the root certificate of the Postgres server}"
  SCRATCH_DB="api_fuzz_$$"
  psql "$ADMIN_URL" -qc "CREATE DATABASE \"$SCRATCH_DB\""
  # Swap the database name, keeping any query string.
  DB_URL="$(sed -E "s#^([^?]*/)[^/?]*(\?.*)?\$#\1${SCRATCH_DB}\2#" <<<"$ADMIN_URL")"
else
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PG_BIN/initdb" ]] || { echo "Postgres server binaries not found; set PG_BIN" >&2; exit 1; }
  # Postgres refuses to run as root.
  if [[ "$(id -u)" == 0 ]]; then RUN_AS=(runuser -u postgres --); fi
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=localhost \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$WORK/server.key" -out "$WORK/server.crt" 2>/dev/null
  rm -rf "$WORK/pgdata"
  if [[ ${#RUN_AS[@]} -gt 0 ]]; then
    chown postgres "$WORK/server.key" "$WORK/server.crt"
    install -d -o postgres "$WORK/pgdata"
  fi
  chmod 600 "$WORK/server.key"
  "${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/pgdata" -U fuzz -A trust >/dev/null
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/pgdata" -w -l "$WORK/pgdata/postgres.log" start -o \
    "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c ssl=on \
-c ssl_cert_file=$WORK/server.crt -c ssl_key_file=$WORK/server.key" >/dev/null
  PG_STARTED=1
  export PG_SSLROOTCERT="$WORK/server.crt"
  ADMIN_URL="postgresql://fuzz@127.0.0.1:$PG_PORT/postgres?sslmode=require"
  psql "$ADMIN_URL" -qc "CREATE DATABASE fuzz"
  DB_URL="postgresql://fuzz@127.0.0.1:$PG_PORT/fuzz?sslmode=require"
fi

for migration in "$ROOT"/migrations/*.sql; do
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
if [[ "$SEED" == 1 ]]; then
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$HERE/seed.sql" >/dev/null
fi

API_BIN="${API_BIN:-}"
if [[ -z "$API_BIN" ]]; then
  (cd "$ROOT" && cargo build -p api --bin api)
  API_BIN="${CARGO_TARGET_DIR:-$ROOT/target}/debug/api"
fi

API_ARGS=(--postgres-url "$DB_URL" --postgres-ssl-root-cert "$PG_SSLROOTCERT" --port "$API_PORT"
  --verified-validators-config "$ROOT/api/verified-validators.yaml.example")
# With no GCP access the protected events are served from a fixture, unless the DB is empty.
if [[ "$SEED" == 1 ]]; then
  API_ARGS+=(--protected-events-file "$HERE/protected-events.json")
fi
BASE="http://127.0.0.1:$API_PORT"
# Something already answering on the port would be fuzzed instead of the API started here.
if curl -s -o /dev/null "$BASE/"; then
  echo "port $API_PORT is already in use; set FUZZ_API_PORT" >&2
  exit 1
fi
"$API_BIN" "${API_ARGS[@]}" >"$WORK/api.log" 2>&1 &
API_PID=$!

READY=0
for _ in $(seq 1 100); do
  kill -0 "$API_PID" 2>/dev/null || { cat "$WORK/api.log" >&2; echo "API exited" >&2; exit 1; }
  curl -fs "$BASE/docs.json" >/dev/null 2>&1 && { READY=1; break; }
  sleep 0.2
done
[[ "$READY" == 1 ]] || { cat "$WORK/api.log" >&2; echo "API did not become ready" >&2; exit 1; }

# Several endpoints answer 500 on purpose while their tables are empty (see api/README.md), so the
# empty run drops the server-error check and instead pins which endpoints may do that.
EXTRA=()
if [[ "$SEED" == 0 ]]; then
  EXTRA=(--exclude-checks not_a_server_error)
  expect_status() {
    local got
    got="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$2")"
    [[ "$got" == "$1" ]] || { echo "empty tables: $2 answered $got, expected $1" >&2; exit 1; }
  }
  for path in /bonds /bonds/bidding /bonds/institutional /bonds/bidding/auction /v1/validators/verified; do
    expect_status 200 "$path"
  done
  for path in /protected-events /v1/protected-events /v1/protected-events/allocation \
    /v1/validators/protected /v1/validators/stake; do
    expect_status 500 "$path"
  done
fi

mkdir -p "$WORK/report"
set +e
(cd "$WORK" && uvx --from "schemathesis==$SCHEMATHESIS_VERSION" schemathesis \
  --config-file "$HERE/schemathesis.toml" run "$BASE/docs.json" --url "$BASE" --checks all \
  --report-dir "$WORK/report" "${EXTRA[@]}" "$@")
RESULT=$?
set -e
echo "API log: $WORK/api.log; report: $WORK/report"
exit "$RESULT"
