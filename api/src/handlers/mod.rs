use crate::error::BadRequest;

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

/// The `from_epoch` query parameter: epochs are stored as INTEGER, so rejecting a larger one here keeps
/// an absurd epoch a 400 rather than a 500 downstream.
pub fn resolve_from_epoch(from_epoch: Option<u64>) -> Result<Option<u64>, BadRequest> {
    match from_epoch {
        Some(epoch) if epoch > MAX_EPOCH => Err(BadRequest {
            message: format!("from_epoch {epoch} is out of range"),
        }),
        _ => Ok(from_epoch),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_omitted_from_epoch_is_accepted() {
        assert_eq!(resolve_from_epoch(None).unwrap(), None);
    }

    #[test]
    fn the_largest_storable_epoch_is_accepted() {
        assert_eq!(
            resolve_from_epoch(Some(MAX_EPOCH)).unwrap(),
            Some(MAX_EPOCH)
        );
    }

    #[test]
    fn one_epoch_past_the_column_is_rejected() {
        let error = resolve_from_epoch(Some(MAX_EPOCH + 1)).unwrap_err();
        assert!(
            error.message.contains("is out of range"),
            "{}",
            error.message
        );
    }
}
