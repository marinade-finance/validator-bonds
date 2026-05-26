//! Per-IP rate limiting for warp routes.
//!
//! Wraps the `governor` crate in a warp filter directly, since warp does
//! not compose with tower layers as ergonomically as axum.
//!
//! # Trust model
//!
//! Client IP is read from `cf-connecting-ip` (trusted when present) and
//! falls back to the peer socket address. This is safe *only* under the
//! invariant that the origin is reachable exclusively through
//! Cloudflare, enforced at the infrastructure layer (security group /
//! WAF / network ACL). If that invariant ever breaks, a client reaching
//! the origin directly can spoof `cf-connecting-ip` to a fresh value
//! per request and obtain a brand-new bucket each time, effectively
//! bypassing the limiter. This is an **accepted risk**: the code does
//! not re-enforce the invariant (e.g. by IP-allowlisting Cloudflare
//! edges) — maintaining an in-code list of CF ranges is operationally
//! brittle and we rely on the network layer instead.
//!
//! # Keyed-store memory
//!
//! `DashMapStateStore` does not evict on its own. [`spawn_limiter_gc`]
//! must be called once per limiter at startup to periodically drop
//! entries whose buckets have fully refilled (equivalent to "this IP
//! currently has no rate-limit state to remember"). Without it, the
//! map grows with every unique observed IP until process restart.
//!
//! # Future work
//!
//! When/if this API migrates to axum, replace with
//! `tower_governor::GovernorLayer` for a cleaner middleware layer.

use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Duration;

use governor::clock::DefaultClock;
use governor::state::keyed::DashMapStateStore;
use governor::{Quota, RateLimiter};
use warp::http::StatusCode;
use warp::reject::Reject;
use warp::reply::{Reply, Response};
use warp::{Filter, Rejection};

/// Per-IP keyed rate limiter (in-memory).
pub type KeyedLimiter = RateLimiter<IpAddr, DashMapStateStore<IpAddr>, DefaultClock>;

/// Rejection returned by [`with_rate_limit`] when the per-IP quota is
/// exceeded. Pair with a `.recover(...)` to render a 429.
#[derive(Debug)]
pub struct RateLimited;
impl Reject for RateLimited {}

/// Per-IP policy for write endpoints: 10 rps, burst 10.
/// Covers a short CLI script running a handful of commands back-to-back
/// from the same (possibly NAT'd) IP without giving abusive clients room
/// to flood. Burst is the `per_second` default in `governor`.
pub fn write_routes_limiter() -> Arc<KeyedLimiter> {
    let quota = Quota::per_second(NonZeroU32::new(10).expect("10 is non-zero"));
    Arc::new(RateLimiter::keyed(quota))
}

/// Per-IP policy for public read endpoints: 30 rps, burst 30.
/// Generous enough for browser dashboards loading several resources at once
/// and for polling monitors, while still blocking scraping-scale floods.
/// Burst is the `per_second` default in `governor`.
pub fn public_routes_limiter() -> Arc<KeyedLimiter> {
    let quota = Quota::per_second(NonZeroU32::new(30).expect("30 is non-zero"));
    Arc::new(RateLimiter::keyed(quota))
}

/// How often the background GC task prunes fully-replenished buckets.
/// Value is a trade-off: too short wastes CPU locking the DashMap under
/// steady load; too long lets memory grow between sweeps. 10 min is
/// well under any realistic memory-pressure horizon for this API.
const LIMITER_GC_INTERVAL: Duration = Duration::from_secs(600);

/// Spawn a background task that periodically evicts IPs whose buckets
/// have fully refilled from `limiter`. Call once per limiter at
/// startup. See the module doc "Keyed-store memory" section for the
/// rationale.
pub fn spawn_limiter_gc(limiter: Arc<KeyedLimiter>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(LIMITER_GC_INTERVAL);
        // `interval` fires immediately on the first tick; skip it so
        // we don't sweep an empty map the moment the server boots.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            limiter.retain_recent();
        }
    });
}

/// Recover filter that maps a [`RateLimited`] rejection to a 429 response.
/// Other rejections are forwarded unchanged so warp's default handling
/// (or any other recover) still applies.
pub async fn recover_rate_limited(err: Rejection) -> Result<Response, Rejection> {
    if err.find::<RateLimited>().is_some() {
        return Ok(
            warp::reply::with_status("Too many requests", StatusCode::TOO_MANY_REQUESTS)
                .into_response(),
        );
    }
    Err(err)
}

/// Warp filter that gates a route on `limiter`, keyed by client IP.
///
/// IP resolution order: `cf-connecting-ip` → peer socket address. The origin
/// is expected to only be reachable through Cloudflare (enforced at the
/// network layer), so `cf-connecting-ip` is trusted when present. Generic
/// forwarding headers (`x-forwarded-for`, `x-real-ip`) are intentionally
/// ignored because they are spoofable and not what Cloudflare sends. If no
/// IP can be determined the request is allowed through.
pub fn with_rate_limit(
    limiter: Arc<KeyedLimiter>,
) -> impl Filter<Extract = (), Error = Rejection> + Clone {
    warp::header::optional::<String>("cf-connecting-ip")
        .and(warp::addr::remote())
        .and_then(move |cf: Option<String>, remote: Option<SocketAddr>| {
            let limiter = limiter.clone();
            async move {
                if let Some(addr) = pick_client_ip(cf.as_deref(), remote) {
                    if limiter.check_key(&addr).is_err() {
                        return Err(warp::reject::custom(RateLimited));
                    }
                }
                Ok::<(), Rejection>(())
            }
        })
        .untuple_one()
}

fn pick_client_ip(cf: Option<&str>, remote: Option<SocketAddr>) -> Option<IpAddr> {
    if let Some(s) = cf {
        if let Ok(ip) = s.parse() {
            return Some(ip);
        }
    }
    remote.map(|s| s.ip())
}
