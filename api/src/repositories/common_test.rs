use crate::repositories::common::{http_transient, read_json_input, read_yaml_input};
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::directory::DirectoryError;
use validator_bonds_common::dto::CollectedStakeRecord;

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

fn temp_file(name: &str, content: &[u8]) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("validator-bonds-test-{name}"));
    std::fs::write(&path, content).expect("the temp file is written");
    path
}

// A `CliError` is what makes the failure appear in the pipeline log at all; a bare
// `anyhow::Error` exits 1 silently.
fn assert_logged_and_not_retried(error: &anyhow::Error) {
    assert!(
        matches!(
            error.downcast_ref::<CliError>(),
            Some(CliError::Critical(_))
        ),
        "expected a critical CliError, got: {error}",
    );
}

#[test]
fn a_missing_input_names_the_path_it_could_not_open() {
    let error = read_yaml_input::<Vec<CollectedStakeRecord>>("/nonexistent/collected.yaml")
        .expect_err("a missing file cannot be read");
    assert!(error.to_string().contains("Failed to open"), "{error}");
    assert!(
        error.to_string().contains("/nonexistent/collected.yaml"),
        "{error}"
    );
    assert_logged_and_not_retried(&error);
}

#[test]
fn malformed_yaml_is_reported_as_critical() {
    let path = temp_file("malformed.yaml", b"- epoch: [unclosed");
    let error = read_yaml_input::<Vec<CollectedStakeRecord>>(path.to_str().expect("utf-8 path"))
        .expect_err("unclosed YAML cannot parse");
    std::fs::remove_file(&path).expect("the temp file is removed");
    assert!(error.to_string().contains("Failed to parse"), "{error}");
    assert_logged_and_not_retried(&error);
}

#[test]
fn malformed_json_is_reported_as_critical() {
    let path = temp_file("malformed.json", b"{ not json");
    let error = read_json_input::<serde_json::Value>(path.to_str().expect("utf-8 path"))
        .expect_err("broken JSON cannot parse");
    std::fs::remove_file(&path).expect("the temp file is removed");
    assert!(error.to_string().contains("Failed to parse"), "{error}");
    assert_logged_and_not_retried(&error);
}

// A file that parses as the wrong shape is the same class of operator error as a syntax slip.
#[test]
fn input_of_the_wrong_shape_is_reported_as_critical() {
    let path = temp_file("wrong-shape.yaml", b"epoch: 1030\n");
    let error = read_yaml_input::<Vec<CollectedStakeRecord>>(path.to_str().expect("utf-8 path"))
        .expect_err("a map is not a list of records");
    std::fs::remove_file(&path).expect("the temp file is removed");
    assert!(error.to_string().contains("Failed to parse"), "{error}");
    assert_logged_and_not_retried(&error);
}

#[test]
fn a_well_formed_input_parses() {
    let path = temp_file("empty-list.yaml", b"[]\n");
    let records: Vec<CollectedStakeRecord> =
        read_yaml_input(path.to_str().expect("utf-8 path")).expect("an empty list parses");
    std::fs::remove_file(&path).expect("the temp file is removed");
    assert!(records.is_empty());
}
