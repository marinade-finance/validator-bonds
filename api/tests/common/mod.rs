//! A marinade-directory store of the tests' own: `fake-gcs-server` for the bucket,
//! the store's own image in front of it, both on the host network, both removed
//! when the harness drops.
//!
//! Without `docker` the tests that need a store say so and pass — the round-trips
//! prove nothing that a stub could not fake, and a box without a container runtime
//! is not a broken build.

use api::context::{Context, WrappedContext};
use api::repositories::common::CommonStoreOptions;
use axum::extract::Request;
use axum::ServiceExt;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::net::SocketAddr;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use validator_bonds_common::directory::Directory;

const GCS_IMAGE: &str = "fsouza/fake-gcs-server:1.56.1";
const STORE_IMAGE: &str = "marinade-directory:test";
const BUCKET: &str = "bonds";
/// HS256 needs 32 bytes; the tests mint their own token against it.
const SECRET: &str = "validator-bonds-test-secret-key-32b";
const STARTUP_ATTEMPTS: u32 = 150;
const STARTUP_INTERVAL: Duration = Duration::from_millis(100);

pub struct Store {
    pub url: String,
    pub token: String,
    containers: Vec<String>,
}

impl Drop for Store {
    fn drop(&mut self) {
        for name in &self.containers {
            match Command::new("docker").args(["rm", "-f", name]).output() {
                Ok(removed) if removed.status.success() => {}
                Ok(removed) => eprintln!(
                    "leaked container {name}: {}",
                    String::from_utf8_lossy(&removed.stderr).trim()
                ),
                Err(err) => eprintln!("leaked container {name}: {err}"),
            }
        }
    }
}

/// `None`, having said why, when `docker` cannot run the two images.
pub async fn start_store() -> Option<Store> {
    if let Err(err) = docker(&["version", "--format", "{{.Server.Version}}"]) {
        println!("skipping: the store harness needs docker: {err}");
        return None;
    }

    let bucket_port = free_port();
    let store_port = free_port();
    let bucket_name = format!("bonds-test-gcs-{bucket_port}");
    let store_name = format!("bonds-test-store-{store_port}");

    // Host network, because the store reaches the bucket emulator by the very host and port
    // the test itself uses.
    docker(&[
        "run",
        "-d",
        "--rm",
        "--name",
        &bucket_name,
        "--network",
        "host",
        GCS_IMAGE,
        "-backend",
        "memory",
        "-scheme",
        "http",
        "-port",
        &bucket_port.to_string(),
        "-public-host",
        &format!("localhost:{bucket_port}"),
    ])
    .expect("the bucket emulator starts");
    let mut store = Store {
        url: format!("http://localhost:{store_port}"),
        token: mint_token(),
        containers: vec![bucket_name],
    };

    let bucket_url = format!("http://localhost:{bucket_port}/storage/v1/b");
    await_ok(&bucket_url).await;
    let created = reqwest::Client::new()
        .post(format!("{bucket_url}?project=validator-bonds"))
        .json(&serde_json::json!({ "name": BUCKET, "versioning": { "enabled": true } }))
        .send()
        .await
        .expect("the bucket is created");
    assert!(
        created.status().is_success(),
        "creating the versioned bucket answered {}",
        created.status(),
    );

    docker(&[
        "run",
        "-d",
        "--rm",
        "--name",
        &store_name,
        "--network",
        "host",
        "-e",
        &format!("STORAGE_EMULATOR_HOST=localhost:{bucket_port}"),
        "-e",
        &format!("GCS_BUCKET={BUCKET}"),
        "-e",
        &format!("JWT_SECRET={SECRET}"),
        "-e",
        &format!("PORT={store_port}"),
        "-e",
        "METRICS_PORT=0",
        STORE_IMAGE,
    ])
    .expect("the store starts");
    store.containers.push(store_name);

    await_ok(&format!("{}/ready", store.url)).await;
    Some(store)
}

pub fn directory(store: &Store) -> Directory {
    Directory::new(&store.url, &store.token)
}

pub fn store_options(store: &Store, input_path: String) -> CommonStoreOptions {
    CommonStoreOptions {
        input_path,
        directory_url: store.url.clone(),
        directory_token: store.token.clone(),
    }
}

pub fn context(directory: Directory) -> WrappedContext {
    Arc::new(RwLock::new(
        Context::new(directory, Arc::new(RwLock::new(None)), vec![]).expect("the context is built"),
    ))
}

/// The production app, middleware and all, over a real socket — the same assembly
/// `bin/api.rs` serves.
pub async fn spawn_api(context: WrappedContext) -> String {
    let app = api::routes::build_app(context);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("the API binds an ephemeral port");
    let addr = listener.local_addr().expect("bound address");
    tokio::spawn(async move {
        axum::serve(
            listener,
            ServiceExt::<Request>::into_make_service_with_connect_info::<SocketAddr>(app),
        )
        .await
        .expect("the API serves")
    });
    await_accepting(addr).await;
    format!("http://{addr}")
}

/// The internal `:9000` server, where `readyz` lives.
pub async fn spawn_internal(context: WrappedContext) -> String {
    let app = api::routes::internal_router(context);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("the internal server binds an ephemeral port");
    let addr = listener.local_addr().expect("bound address");
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .await
            .expect("the internal server serves")
    });
    await_accepting(addr).await;
    format!("http://{addr}")
}

/// Test inputs are the YAML the collector prints, read back by the store commands.
pub fn write_yaml<T: serde::Serialize>(name: &str, value: &T) -> String {
    std::fs::create_dir_all("./tmp").expect("./tmp is writable");
    let path = format!("./tmp/{name}.yaml");
    let file = std::fs::File::create(&path).expect("the input file is written");
    serde_yaml::to_writer(file, value).expect("the input file is YAML");
    path
}

pub async fn get_json(url: &str) -> serde_json::Value {
    let response = reqwest::get(url).await.expect("the API answers");
    assert!(
        response.status().is_success(),
        "{url} answered {}",
        response.status()
    );
    response.json().await.expect("the API answers JSON")
}

fn docker(args: &[&str]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Bind and release: the port is free at this instant, which is as close as a
/// container started a moment later can get.
pub fn free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .expect("an ephemeral port is free")
        .local_addr()
        .expect("bound address")
        .port()
}

async fn await_ok(url: &str) {
    for _ in 0..STARTUP_ATTEMPTS {
        if let Ok(response) = reqwest::get(url).await {
            if response.status().is_success() {
                return;
            }
        }
        tokio::time::sleep(STARTUP_INTERVAL).await;
    }
    panic!("{url} did not answer in time");
}

async fn await_accepting(addr: SocketAddr) {
    for _ in 0..STARTUP_ATTEMPTS {
        if tokio::net::TcpStream::connect(addr).await.is_ok() {
            return;
        }
        tokio::time::sleep(STARTUP_INTERVAL).await;
    }
    panic!("the server at {addr} did not start accepting connections in time");
}

/// A grant carries the leading slash — `bonds/**` matches nothing.
fn mint_token() -> String {
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is past the epoch")
        .as_secs()
        + 3600;
    let header = encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = encode(
        format!(r#"{{"sub":"api-tests","grants":["/bonds/**:rw"],"exp":{expiry}}}"#).as_bytes(),
    );

    let signed = format!("{header}.{claims}");
    let mut mac = Hmac::<Sha256>::new_from_slice(SECRET.as_bytes()).expect("HMAC takes any key");
    mac.update(signed.as_bytes());
    format!("{signed}.{}", encode(&mac.finalize().into_bytes()))
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
