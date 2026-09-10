//! Client for marinade-directory, the versioned JSON document store.
//!
//! Paths are absolute and carry no `/v1` prefix — `/bonds/bidding/750` is
//! requested as `{url}/v1/bonds/bidding/750`. Every `/v1` request carries the
//! bearer token; `/ready` is the one anonymous endpoint.

use serde::de::DeserializeOwned;
use serde::Serialize;

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
    Body {
        path: String,
        #[source]
        source: reqwest::Error,
    },
}

pub struct Directory {
    url: String,
    token: String,
    client: reqwest::Client,
}

impl Directory {
    pub fn new(url: &str, token: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').to_owned(),
            token: token.to_owned(),
            client: reqwest::Client::new(),
        }
    }

    /// `None` for a path the store does not have, which every caller reads as
    /// the empty set the missing table used to produce.
    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<Option<Doc<T>>, DirectoryError> {
        let response = self
            .client
            .get(self.endpoint(path))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|source| DirectoryError::Transport {
                path: path.to_owned(),
                source,
            })?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let response = checked(path, response).await?;
        let etag = etag(path, &response)?;
        let body = response
            .json()
            .await
            .map_err(|source| DirectoryError::Body {
                path: path.to_owned(),
                source,
            })?;
        Ok(Some(Doc { body, etag }))
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

    /// The store's own probe: it answers once its bucket is reachable.
    pub async fn ready(&self) -> Result<(), DirectoryError> {
        let response = self
            .client
            .get(format!("{}/ready", self.url))
            .send()
            .await
            .map_err(|source| DirectoryError::Transport {
                path: "/ready".to_owned(),
                source,
            })?;
        checked("/ready", response).await?;
        Ok(())
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/v1{path}", self.url)
    }
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
