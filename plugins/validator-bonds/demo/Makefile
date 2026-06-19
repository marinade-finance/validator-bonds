SHELL  := bash
DIR    := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
COLS   := 140
ROWS   := 35
IMAGE  := debian:bookworm

# prereqs: asciinema (pip install asciinema), agg (cargo install agg)

PLUGIN  := $(abspath $(DIR)..)
DOCKER  = docker run --rm -it \
    -e CLAUDE_CODE_OAUTH_TOKEN \
    -e TERM=xterm-256color \
    -e COLUMNS=$(COLS) \
    -e LINES=$(ROWS)

.PHONY: demo record gif run-install run-qa run-qa-local check-auth clean

check-auth:
	@test -n "$$CLAUDE_CODE_OAUTH_TOKEN" || { echo "Error: CLAUDE_CODE_OAUTH_TOKEN not set"; exit 1; }

demo: check-auth install.gif qa.gif

# ── live runs (no recording) ──────────────────────────────────────────────────

run-install: check-auth
	$(DOCKER) -v "$(DIR)install.sh:/demo.sh:ro" $(IMAGE) bash /demo.sh

run-qa: check-auth
	$(DOCKER) -v "$(DIR)qa.sh:/demo.sh:ro" $(IMAGE) bash /demo.sh

run-qa-local: check-auth
	$(DOCKER) -v "$(DIR)qa.local.sh:/demo.sh:ro" -v "$(PLUGIN):/plugin:ro" $(IMAGE) bash /demo.sh

# ── recordings ────────────────────────────────────────────────────────────────

record: check-auth install.cast qa.cast

install.cast: check-auth
	asciinema rec $@ --overwrite --cols $(COLS) --rows $(ROWS) -c \
	    'docker run --rm -it -v "$(DIR)install.sh:/demo.sh:ro" -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLUMNS=$(COLS) -e LINES=$(ROWS) $(IMAGE) bash /demo.sh'

qa.cast: check-auth
	asciinema rec $@ --overwrite --cols $(COLS) --rows $(ROWS) -c \
	    'docker run --rm -it -v "$(DIR)qa.sh:/demo.sh:ro" -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLUMNS=$(COLS) -e LINES=$(ROWS) $(IMAGE) bash /demo.sh'

qa.local.cast: check-auth
	asciinema rec $@ --overwrite --cols $(COLS) --rows $(ROWS) -c \
	    'docker run --rm -it -v "$(DIR)qa.local.sh:/demo.sh:ro" -v "$(PLUGIN):/plugin:ro" -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLUMNS=$(COLS) -e LINES=$(ROWS) $(IMAGE) bash /demo.sh'

# ── GIF conversion ────────────────────────────────────────────────────────────

gif: install.gif qa.gif

%.gif: %.cast
	agg $< $@

clean:
	rm -f install.cast qa.cast qa.local.cast install.gif qa.gif qa.local.gif
