use crate::repositories::common::http_transient;
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::directory::DirectoryError;

fn status(status: u16) -> DirectoryError {
    DirectoryError::Status {
        path: "/bonds/bidding/750".to_owned(),
        status,
        body: String::new(),
    }
}

#[test]
fn a_fault_on_the_store_side_is_retried() {
    assert!(matches!(
        http_transient(status(503)),
        CliError::RetryAble(_)
    ));
}

#[test]
fn a_refused_request_is_critical() {
    for refused in [status(401), status(403), status(404)] {
        assert!(matches!(http_transient(refused), CliError::Critical(_)));
    }
}

// A 412 conflict -> critical, never retried: the serialization gate keeps writers apart.
#[test]
fn a_conflict_is_critical() {
    let conflict = DirectoryError::Conflict {
        path: "/bonds/bidding/750".to_owned(),
    };
    assert!(matches!(http_transient(conflict), CliError::Critical(_)));
}
