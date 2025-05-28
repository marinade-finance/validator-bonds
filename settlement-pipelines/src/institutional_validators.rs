use log::{error, warn};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use reqwest;
use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Deserialize)]
pub struct Validator {
    pub name: String,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_pubkey: Pubkey,
}

#[derive(Debug, Deserialize, Default)]
pub struct ValidatorsData {
    pub validators: Vec<Validator>,
}

pub async fn fetch_validator_data(url: &str) -> ValidatorsData {
    warn!(
        "Institutional URL {} defined - reporting will be adjusted. Fetching data.",
        url
    );
    try_fetch_validator_data(url).await.unwrap_or_else(|e| {
        error!("Error fetching '{}' validator data: {}", url, e);
        ValidatorsData {
            validators: Vec::new(),
        }
    })
}

async fn try_fetch_validator_data(url: &str) -> Result<ValidatorsData, Box<dyn std::error::Error>> {
    let response = reqwest::get(url).await?;
    let json_text = response.text().await?;
    let validator_data: ValidatorsData = serde_json::from_str(&json_text)?;
    Ok(validator_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_validator_data() {
        let json = r#"
        {
            "validators": [
                {
                    "name": "Test Validator",
                    "vote_pubkey": "FQwewNXahV7MiZcLpY6p1xhUs2acVGQ3U5Xxc7FzV571"
                }
            ]
        }
        "#;

        let validator_data: ValidatorsData = serde_json::from_str(json).unwrap();
        assert_eq!(validator_data.validators.len(), 1);
        assert_eq!(validator_data.validators[0].name, "Test Validator");
    }

    #[tokio::test]
    async fn test_fetch_validator_data_invalid_url() {
        let result =
            fetch_validator_data("https://invalid-url-that-does-not-exist-12345.com").await;
        // Should return empty array on connection error
        assert!(result.validators.is_empty());
    }
}
