//! Client for marinade-directory, the versioned JSON document store.
//!
//! Paths are absolute and carry no `/v1` prefix — `/bonds/bidding/750` is
//! requested as `{url}/v1/bonds/bidding/750`. Every `/v1` request carries the
//! bearer token; `/ready` is the one anonymous endpoint.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

/// A document as the store served it, with the version to send back in `If-Match`.
#[derive(Debug)]
pub struct Doc<T> {
    pub body: T,
    pub etag: String,
}

/// The store refuses a `PUT` that carries neither, so every write states which
/// version it assumes it is replacing.
pub enum Precondition {
    Create,
    IfMatch(String),
}

#[derive(Debug, thiserror::Error)]
pub enum DirectoryError {
    #[error("{path}: the stored version is not the one this write assumed")]
    Conflict { path: String },
    #[error("{path}: the store answered {status}: {body}")]
    Status {
        path: String,
        status: u16,
        body: String,
    },
    #[error("{path}: the request to the store failed")]
    Transport {
        path: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("{path}: the store answered without an ETag")]
    MissingEtag { path: String },
    #[error("{path}: the stored document does not have the expected shape")]
    Decode {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("{path}: the stored document does not have the expected shape")]
    Body {
        path: String,
        #[source]
        source: reqwest::Error,
    },
}

/// Bounds one store request. The handlers above have no timeout of their own.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Read by the readiness probe. Any stored path would do; this one is read by
/// the service anyway, so the probe exercises a real grant rather than a
/// reachability check.
const READINESS_PATH: &str = "/bonds/stake/@last";

pub struct Directory {
    url: String,
    token: String,
    client: reqwest::Client,
    /// The last body seen at each path, with the ETag it carried.
    ///
    /// The store meters a token by the bytes it serves, over a rolling window,
    /// and these documents are hundreds of kilobytes that every request reads
    /// whole. Served unconditionally, one ordinary consumer polling once a
    /// second exhausts the budget in minutes, after which the store answers
    /// 429 and every route here fails until the window rolls. A conditional
    /// request costs nothing when the document has not moved, and the ETag is
    /// taken over the resolved path, so `@last` moving to a new epoch misses
    /// the check and refetches on its own.
    seen: Mutex<HashMap<String, (String, Vec<u8>)>>,
}

impl Directory {
    pub fn new(url: &str, token: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').to_owned(),
            token: token.to_owned(),
            // reqwest has no default timeout, and nothing above this bounds a
            // handler: a store that stops answering mid-response would park
            // every in-flight request until the process ran out of memory.
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("a reqwest client with only a timeout set cannot fail to build"),
            seen: Mutex::new(HashMap::new()),
        }
    }

    /// `None` for a path the store does not have; every caller reads that as
    /// an empty set, not an error.
    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<Option<Doc<T>>, DirectoryError> {
        let known = self.remembered(path);
        let mut request = self
            .client
            .get(self.endpoint(path))
            .bearer_auth(&self.token);
        if let Some((etag, _)) = &known {
            request = request.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        let response = request
            .send()
            .await
            .map_err(|source| DirectoryError::Transport {
                path: path.to_owned(),
                source,
            })?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            self.forget(path);
            return Ok(None);
        }
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some((etag, bytes)) = known {
                return Ok(Some(Doc {
                    body: parse(path, &bytes)?,
                    etag,
                }));
            }
        }

        let response = checked(path, response).await?;
        let etag = etag(path, &response)?;
        let bytes = response
            .bytes()
            .await
            .map_err(|source| DirectoryError::Body {
                path: path.to_owned(),
                source,
            })?;
        let body = parse(path, &bytes)?;
        self.remember(path, &etag, bytes.to_vec());
        Ok(Some(Doc { body, etag }))
    }

    fn remembered(&self, path: &str) -> Option<(String, Vec<u8>)> {
        self.seen
            .lock()
            .expect("directory cache")
            .get(path)
            .cloned()
    }

    fn remember(&self, path: &str, etag: &str, bytes: Vec<u8>) {
        self.seen
            .lock()
            .expect("directory cache")
            .insert(path.to_owned(), (etag.to_owned(), bytes));
    }

    fn forget(&self, path: &str) {
        self.seen.lock().expect("directory cache").remove(path);
    }

    /// The stored version after the write.
    pub async fn put<T: Serialize>(
        &self,
        path: &str,
        body: &T,
        precondition: Precondition,
    ) -> Result<String, DirectoryError> {
        let request = self
            .client
            .put(self.endpoint(path))
            .bearer_auth(&self.token)
            .json(body);
        let request = match precondition {
            Precondition::Create => request.header(reqwest::header::IF_NONE_MATCH, "*"),
            Precondition::IfMatch(version) => request.header(reqwest::header::IF_MATCH, version),
        };

        let response = request
            .send()
            .await
            .map_err(|source| DirectoryError::Transport {
                path: path.to_owned(),
                source,
            })?;
        let response = checked(path, response).await?;
        etag(path, &response)
    }

    /// Create, and on the conflict a re-run for an already written path produces,
    /// replace the version the store currently holds. The replace is not retried:
    /// a second conflict means a concurrent writer, which is the alarm and not a
    /// condition to write through.
    pub async fn put_or_replace<T: Serialize>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<String, DirectoryError> {
        match self.put(path, body, Precondition::Create).await {
            Err(DirectoryError::Conflict { .. }) => {}
            created => return created,
        }

        let current = self
            .get::<serde::de::IgnoredAny>(path)
            .await?
            .ok_or_else(|| DirectoryError::Conflict {
                path: path.to_owned(),
            })?;
        self.put(path, body, Precondition::IfMatch(current.etag))
            .await
    }

    /// Readiness, asked as this service asks for data: an authenticated read.
    ///
    /// The store's own `/ready` sits outside its authenticator, so a probe
    /// against it answers for the bucket and says nothing about the token —
    /// and every token carries an expiry the store enforces. Probing it left
    /// a pod reporting Ready while every read answered 401.
    ///
    /// A path the store does not hold is ready: a fresh deployment is ready
    /// before its first write, which is why `/ready` was chosen originally.
    pub async fn ready(&self) -> Result<(), DirectoryError> {
        self.get::<serde::de::IgnoredAny>(READINESS_PATH).await?;
        Ok(())
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/v1{path}", self.url)
    }
}

fn parse<T: DeserializeOwned>(path: &str, bytes: &[u8]) -> Result<T, DirectoryError> {
    serde_json::from_slice(bytes).map_err(|source| DirectoryError::Decode {
        path: path.to_owned(),
        source,
    })
}

async fn checked(
    path: &str,
    response: reqwest::Response,
) -> Result<reqwest::Response, DirectoryError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if status == reqwest::StatusCode::PRECONDITION_FAILED {
        return Err(DirectoryError::Conflict {
            path: path.to_owned(),
        });
    }
    let body = response
        .text()
        .await
        .unwrap_or_else(|err| format!("<unreadable body: {err}>"));
    Err(DirectoryError::Status {
        path: path.to_owned(),
        status: status.as_u16(),
        body,
    })
}

/// The store spells the header `Etag`; header names match case-insensitively.
fn etag(path: &str, response: &reqwest::Response) -> Result<String, DirectoryError> {
    response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|version| version.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| DirectoryError::MissingEtag {
            path: path.to_owned(),
        })
}

#[cfg(test)]
#[path = "directory_test.rs"]
mod directory_test;
