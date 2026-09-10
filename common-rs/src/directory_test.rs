use crate::directory::{Directory, DirectoryError, Precondition};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const CREATED: &str =
    "HTTP/1.1 201 Created\r\nEtag: \"v1\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const REPLACED: &str =
    "HTTP/1.1 200 OK\r\nEtag: \"v3\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const CONFLICT: &str =
    "HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const MISSING: &str = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const FAULT: &str =
    "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 7\r\nConnection: close\r\n\r\nno luck";
// The header spelling the store emits, which is what the client has to match.
const DOCUMENT: &str = "HTTP/1.1 200 OK\r\nEtag: \"v2\"\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"epoch\":750}";

/// Long enough for a local client to read an answer it already has, short enough that a
/// client that never closes fails the test instead of hanging it.
const DRAIN: std::time::Duration = std::time::Duration::from_secs(5);

struct Stub {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
}

impl Stub {
    fn request(&self, index: usize) -> String {
        self.requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())[index]
            .clone()
    }
}

/// Answers connections with the canned responses in order. Each response closes
/// its connection, so one request lands on one response.
async fn stub(responses: Vec<&'static str>) -> Stub {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("the stub binds an ephemeral port");
    let url = format!("http://{}", listener.local_addr().expect("bound address"));
    let requests = Arc::new(Mutex::new(Vec::new()));
    tokio::spawn(serve(listener, responses, requests.clone()));
    Stub { url, requests }
}

async fn serve(
    listener: tokio::net::TcpListener,
    responses: Vec<&'static str>,
    requests: Arc<Mutex<Vec<String>>>,
) {
    for response in responses {
        let (mut socket, _) = listener.accept().await.expect("the stub accepts");
        let mut buffer = [0u8; 8192];
        let read = socket.read(&mut buffer).await.expect("the stub reads");
        requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(String::from_utf8_lossy(&buffer[..read]).into_owned());
        socket
            .write_all(response.as_bytes())
            .await
            .expect("the stub answers");
        socket.shutdown().await.expect("the stub closes");
        // Closing with the request body still unread would RST the answer away before the
        // client reads it, so wait for the client's own close.
        let mut rest = Vec::new();
        let drained = tokio::time::timeout(DRAIN, socket.read_to_end(&mut rest)).await;
        if drained.is_err() {
            eprintln!("the stub gave up waiting for the client to close");
        }
    }
}

fn directory(stub: &Stub) -> Directory {
    Directory::new(&stub.url, "test-token")
}

#[tokio::test]
async fn a_missing_document_reads_as_none() {
    let stub = stub(vec![MISSING]).await;
    let read = directory(&stub)
        .get::<serde_json::Value>("/bonds/bidding/@last")
        .await
        .expect("a 404 is not an error");
    assert!(read.is_none());
    assert!(
        stub.request(0)
            .starts_with("GET /v1/bonds/bidding/@last HTTP/1.1"),
        "the path must be requested under /v1: {}",
        stub.request(0),
    );
    assert!(
        stub.request(0).contains("authorization: Bearer test-token"),
        "every /v1 request carries the token: {}",
        stub.request(0),
    );
}

#[tokio::test]
async fn a_document_carries_the_version_to_replace_it_with() {
    let stub = stub(vec![DOCUMENT]).await;
    let read = directory(&stub)
        .get::<serde_json::Value>("/bonds/bidding/750")
        .await
        .expect("the document is served")
        .expect("the document exists");
    assert_eq!(read.body["epoch"], 750);
    assert_eq!(read.etag, "\"v2\"");
}

#[tokio::test]
async fn a_refused_create_is_a_typed_conflict() {
    let stub = stub(vec![CONFLICT]).await;
    let refused = directory(&stub)
        .put("/bonds/bidding/750", &"body", Precondition::Create)
        .await
        .expect_err("a create over an existing path is refused");
    assert!(
        matches!(refused, DirectoryError::Conflict { .. }),
        "412 must not read as a plain failure: {refused}",
    );
    assert!(
        stub.request(0).contains("if-none-match: *"),
        "a create states its precondition: {}",
        stub.request(0),
    );
}

#[tokio::test]
async fn put_or_replace_replaces_the_version_it_conflicted_with() {
    let stub = stub(vec![CONFLICT, DOCUMENT, REPLACED]).await;
    let version = directory(&stub)
        .put_or_replace("/bonds/bidding/750", &"body")
        .await
        .expect("the conflicting create is followed by a replace");
    assert_eq!(version, "\"v3\"");
    assert!(
        stub.request(2).contains("if-match: \"v2\""),
        "the replace must carry the version the read returned: {}",
        stub.request(2),
    );
}

#[tokio::test]
async fn a_created_document_returns_its_version() {
    let stub = stub(vec![CREATED]).await;
    let version = directory(&stub)
        .put("/bonds/stake/750", &"body", Precondition::Create)
        .await
        .expect("the create succeeds");
    assert_eq!(version, "\"v1\"");
    assert!(
        stub.request(0).contains("content-type: application/json"),
        "bodies are sent as JSON: {}",
        stub.request(0),
    );
}

#[tokio::test]
async fn a_server_fault_carries_its_status() {
    let stub = stub(vec![FAULT]).await;
    let failed = directory(&stub)
        .get::<serde_json::Value>("/bonds/stake/@last")
        .await
        .expect_err("a 503 is an error");
    assert!(
        matches!(failed, DirectoryError::Status { status: 503, .. }),
        "the status has to survive for the caller to classify it: {failed}",
    );
}

#[tokio::test]
async fn ready_is_probed_without_a_token() {
    let stub = stub(vec![REPLACED]).await;
    directory(&stub).ready().await.expect("the store is ready");
    let probe = stub.request(0);
    assert!(
        probe.starts_with("GET /ready HTTP/1.1"),
        "the probe is not under /v1: {probe}",
    );
    assert!(
        !probe.contains("authorization:"),
        "the probe is anonymous: {probe}",
    );
}
