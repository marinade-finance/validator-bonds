use crate::directory::{Directory, DirectoryError, Precondition};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REPLACED: &str =
    "HTTP/1.1 200 OK\r\nEtag: \"v3\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const CONFLICT: &str =
    "HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const MISSING: &str = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const NOT_MODIFIED: &str = "HTTP/1.1 304 Not Modified\r\nEtag: \"v2\"\r\nConnection: close\r\n\r\n";
const UNAUTHORIZED: &str =
    "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const FAULT: &str =
    "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 7\r\nConnection: close\r\n\r\nno luck";
const DOCUMENT: &str = "HTTP/1.1 200 OK\r\nEtag: \"v2\"\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"epoch\":750}";

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
        // Closing with the request unread would RST the answer away; wait for the client.
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
        stub.request(0).contains("content-type: application/json"),
        "bodies are sent as JSON: {}",
        stub.request(0),
    );
    assert!(
        stub.request(2).contains("if-match: \"v2\""),
        "the replace must carry the version the read returned: {}",
        stub.request(2),
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
async fn ready_is_probed_with_the_token_this_service_reads_with() {
    let stub = stub(vec![DOCUMENT]).await;
    directory(&stub).ready().await.expect("the store is ready");
    let probe = stub.request(0);
    assert!(
        probe.starts_with("GET /v1/bonds/stake/@last HTTP/1.1"),
        "the probe reads a real path: {probe}",
    );
    assert!(
        probe.to_lowercase().contains("authorization: bearer"),
        "an anonymous probe cannot see the token expire: {probe}",
    );
}

/// A store that does not hold the path is still ready: a fresh deployment is
/// ready before its first write.
#[tokio::test]
async fn ready_accepts_a_path_the_store_does_not_hold() {
    let stub = stub(vec![MISSING]).await;
    directory(&stub)
        .ready()
        .await
        .expect("an empty store is ready");
}

#[tokio::test]
async fn a_rejected_token_makes_the_service_unready() {
    let stub = stub(vec![UNAUTHORIZED]).await;
    directory(&stub)
        .ready()
        .await
        .expect_err("a 401 is not ready");
}

/// The store meters a token by the bytes it serves, so a document that has not
/// moved must not be served again.
#[tokio::test]
async fn a_second_read_is_conditional_and_reuses_the_body() {
    let stub = stub(vec![DOCUMENT, NOT_MODIFIED]).await;
    let directory = directory(&stub);

    let first = directory
        .get::<serde_json::Value>("/bonds/stake/@last")
        .await
        .expect("first read")
        .expect("a document");
    assert!(
        !stub.request(0).to_lowercase().contains("if-none-match"),
        "nothing is known yet on the first read: {}",
        stub.request(0),
    );

    let second = directory
        .get::<serde_json::Value>("/bonds/stake/@last")
        .await
        .expect("second read")
        .expect("a document");
    assert!(
        stub.request(1).contains("if-none-match: \"v2\""),
        "the second read carries the ETag it was given: {}",
        stub.request(1),
    );
    assert_eq!(first.etag, "\"v2\"");
    assert_eq!(second.body, first.body, "a 304 answers from what was read");
    assert_eq!(second.etag, first.etag);
}
