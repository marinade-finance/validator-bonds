use anyhow::Context;
use log::info;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
struct EpochPmpeEntry {
    epoch: u64,
    pmpe: Decimal,
}

#[derive(Deserialize)]
struct EpochPmpeResponse {
    epochs: Vec<EpochPmpeEntry>,
}

// SSI and SSR refer to the same network-wide Solana Staking Index/Rate (pmpe).
pub fn fetch_ssr_pmpe(apy_api_url: &str, epoch: u64) -> anyhow::Result<Decimal> {
    let url = format!("{}/v1/epoch-pmpe/ssr", apy_api_url.trim_end_matches('/'));
    info!("Fetching SSI/SSR pmpe for epoch {epoch} from {url}");
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp: EpochPmpeResponse = client
        .get(&url)
        .send()
        .with_context(|| format!("apy-api request failed for {url}"))?
        .error_for_status()?
        .json()
        .with_context(|| format!("apy-api json parsing failed for {url}"))?;
    resp.epochs
        .iter()
        .find(|e| e.epoch == epoch)
        .map(|e| e.pmpe)
        .ok_or_else(|| anyhow::anyhow!("SSI/SSR for epoch {epoch} not yet available at {url}"))
}
