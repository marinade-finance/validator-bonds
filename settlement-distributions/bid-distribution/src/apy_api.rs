use log::info;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Deserialize)]
struct EpochPmpeEntry {
    epoch: u64,
    pmpe: Decimal,
}

#[derive(Deserialize)]
struct EpochPmpeResponse {
    epochs: Vec<EpochPmpeEntry>,
}

pub fn fetch_ssr_pmpe(apy_api_url: &str, epoch: u64) -> anyhow::Result<Decimal> {
    let url = format!("{apy_api_url}/v1/epoch-pmpe/ssr");
    info!("Fetching SSR pmpe for epoch {epoch} from {url}");
    let resp: EpochPmpeResponse = reqwest::blocking::get(&url)?.error_for_status()?.json()?;
    resp.epochs
        .iter()
        .find(|e| e.epoch == epoch)
        .map(|e| e.pmpe)
        .ok_or_else(|| anyhow::anyhow!("SSR for epoch {epoch} not yet available at {url}"))
}
