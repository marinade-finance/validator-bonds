pub mod bonds;
pub mod collected_stake;
pub mod direct_staking_allocation;
pub mod docs;
pub mod protected_events;
pub mod protected_validators;
pub mod verified_validators;

/// Largest epoch any endpoint accepts: epochs are stored as INTEGER, and a larger one can only be a
/// mistake. Mirrored by `maximum` on the epoch query parameters in the OpenAPI document.
pub const MAX_EPOCH: u64 = i32::MAX as u64;
