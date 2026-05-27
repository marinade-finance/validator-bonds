//! Per-IP rate limiting via `tower_governor`.
//!
//! # Trust model
//!
//! Client IP is read from `cf-connecting-ip` (trusted when present) and
//! falls back to the peer socket address (axum `ConnectInfo`). This is safe
//! *only* under the invariant that the origin is reachable exclusively through
//! Cloudflare, enforced at the infrastructure layer (security group / WAF /
//! network ACL). If that invariant ever breaks, a client reaching the origin
//! directly can spoof `cf-connecting-ip` to a fresh value per request and
//! obtain a brand-new bucket each time, effectively bypassing the limiter.
//! This is an **accepted risk**: we rely on the network layer.
//!
//! Generic forwarding headers (`x-forwarded-for`, `x-real-ip`) are
//! intentionally NOT consulted — they are spoofable and not what Cloudflare
//! sends. This is why we use a custom [`CfConnectingIpKeyExtractor`] rather
//! than `tower_governor`'s `SmartIpKeyExtractor` (which would trust them).

use std::net::{IpAddr, SocketAddr};

use axum::extract::ConnectInfo;
use axum::http::Request;
use tower_governor::key_extractor::KeyExtractor;
use tower_governor::GovernorError;

/// Per-IP rate-limit key: `cf-connecting-ip` when present and parseable,
/// otherwise the peer socket IP. See the module-level trust model.
#[derive(Clone, Debug)]
pub struct CfConnectingIpKeyExtractor;

impl KeyExtractor for CfConnectingIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        let cf = req
            .headers()
            .get("cf-connecting-ip")
            .and_then(|v| v.to_str().ok());
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ci| ci.0);
        pick_client_ip(cf, peer).ok_or(GovernorError::UnableToExtractKey)
    }
}

/// IP resolution: a valid `cf-connecting-ip` wins; otherwise the peer IP.
fn pick_client_ip(cf: Option<&str>, remote: Option<SocketAddr>) -> Option<IpAddr> {
    if let Some(s) = cf {
        if let Ok(ip) = s.parse() {
            return Some(ip);
        }
    }
    remote.map(|s| s.ip())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    fn sock(ip: &str) -> SocketAddr {
        SocketAddr::new(ip.parse().unwrap(), 1234)
    }

    #[test]
    fn cf_connecting_ip_is_used_when_valid() {
        assert_eq!(
            pick_client_ip(Some("1.2.3.4"), Some(sock("9.9.9.9"))),
            Some(IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4))),
            "valid cf-connecting-ip must win over the peer address",
        );
    }

    #[test]
    fn cf_connecting_ip_supports_ipv6() {
        assert_eq!(
            pick_client_ip(Some("::1"), None),
            Some(IpAddr::V6(Ipv6Addr::LOCALHOST)),
        );
    }

    #[test]
    fn falls_back_to_peer_when_cf_missing_or_unparseable() {
        let peer = Some(sock("9.9.9.9"));
        assert_eq!(
            pick_client_ip(None, peer),
            Some(IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9))),
            "no cf header → peer ip",
        );
        assert_eq!(
            pick_client_ip(Some("not-an-ip"), peer),
            Some(IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9))),
            "garbage cf header → peer ip",
        );
    }

    #[test]
    fn returns_none_when_no_ip_available() {
        assert_eq!(pick_client_ip(None, None), None);
        assert_eq!(pick_client_ip(Some("garbage"), None), None);
    }
}
