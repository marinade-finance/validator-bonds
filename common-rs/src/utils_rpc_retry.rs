use anyhow::anyhow;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::pubkey::Pubkey;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::{sleep, timeout, Instant};

#[derive(Debug)]
pub enum RetryError {
    Timeout(Duration),
    MaxRetriesExceeded { retries: u32, error: anyhow::Error },
    InvalidConfig,
}

impl std::fmt::Display for RetryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RetryError::Timeout(duration) => write!(f, "Operation timed out after {:?}", duration),
            RetryError::MaxRetriesExceeded { retries, error } => {
                write!(f, "Operation failed after {} retries: {}", retries, error)
            }
            RetryError::InvalidConfig => write!(
                f,
                "Invalid retry configuration: both max_retries and timeout_duration cannot be None"
            ),
        }
    }
}

impl std::error::Error for RetryError {}

pub struct RetryConfig {
    pub max_retries: Option<u32>,
    pub timeout_duration: Option<Duration>,
    pub retry_delay: Duration,
}

impl RetryConfig {
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.max_retries.is_none() && self.timeout_duration.is_none() {
            return Err(anyhow!(RetryError::InvalidConfig));
        }
        Ok(())
    }
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: None,
            timeout_duration: Some(Duration::from_secs(30)),
            retry_delay: Duration::from_secs(2),
        }
    }
}

pub async fn retry_get_pubkeys_operation<'a, T, F, Fut>(
    rpc_client: Arc<RpcClient>,
    pubkeys: &'a [Pubkey],
    operation: F,
    config: Option<RetryConfig>,
) -> anyhow::Result<Vec<(Pubkey, Option<T>)>>
where
    F: Fn(Arc<RpcClient>, &'a [Pubkey]) -> Fut + 'a,
    Fut: Future<Output = anyhow::Result<Vec<(Pubkey, Option<T>)>>>,
{
    let config = config.unwrap_or_default();
    config.validate()?;

    let start_time = Instant::now();
    let mut retries = 0;
    let mut last_error = None;

    loop {
        // Check if we've exceeded max retries (if specified)
        if let Some(max_retries) = config.max_retries {
            if retries >= max_retries {
                return Err(anyhow!(RetryError::MaxRetriesExceeded {
                    retries,
                    error: last_error.unwrap(),
                }));
            }
        }

        // Check if we've exceeded timeout duration (if specified)
        if let Some(timeout_duration) = config.timeout_duration {
            if start_time.elapsed() >= timeout_duration {
                return Err(anyhow!(RetryError::Timeout(timeout_duration)));
            }
        }

        // Calculate remaining timeout for this iteration
        let remaining_timeout = config
            .timeout_duration
            .map(|d| d.saturating_sub(start_time.elapsed()))
            .unwrap_or(Duration::from_secs(30)); // Default timeout per attempt if no total timeout specified

        match timeout(remaining_timeout, operation(rpc_client.clone(), pubkeys)).await {
            Ok(Ok(result)) => return Ok(result),
            Ok(Err(e)) => {
                last_error = Some(e);
                retries += 1;

                // If we have neither exceeded max retries nor timeout, continue after delay
                if (config.max_retries.is_none() || retries < config.max_retries.unwrap())
                    && (config.timeout_duration.is_none()
                        || start_time.elapsed() < config.timeout_duration.unwrap())
                {
                    sleep(config.retry_delay).await;
                    continue;
                }

                // If we reach here with no timeout specified, we must have hit max_retries
                return Err(anyhow!(RetryError::MaxRetriesExceeded {
                    retries,
                    error: last_error.unwrap(),
                }));
            }
            Err(_) => {
                // Individual attempt timeout
                if let Some(timeout_duration) = config.timeout_duration {
                    if start_time.elapsed() >= timeout_duration {
                        return Err(anyhow!(RetryError::Timeout(timeout_duration)));
                    }
                }
                retries += 1;
                sleep(config.retry_delay).await;
            }
        }
    }
}
