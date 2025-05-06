use rust_decimal::Decimal;
use serde::de;
use std::str::FromStr;

/// The custom deserialize_bigint function handles parsing string representations of big integers.
/// As the TypeScript codebase uses strings to represent big integers, this function is necessary.
pub fn deserialize_bigint<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: String = serde::Deserialize::deserialize(deserializer)?;
    s.parse::<u64>().map_err(serde::de::Error::custom)
}

/// The custom deserialize_large_decimal function handles parsing string representations of large decimal numbers.
/// The TypeScript institutional staking codebase saves the decimal as scientific notation.
/// This function tries to handle specific cases where the decimal is extremely large and Rust is not capable of parsing it.
/// This happened e.g., for epoch 779 with validator '6H9J5xtcqGwh2hd2GpBHfvrnDicWk8GtvpnypH7piktA' that has got with stake 0.01 SOL
/// extremely high MEV (39 SOLs)/block(29 SOLs) rewards (https://console.cloud.google.com/storage/browser/_details/jito-mainnet/779/tip-router-rpc-1/779-stake-meta-collection.json)
pub fn deserialize_large_decimal<'de, D>(deserializer: D) -> Result<Decimal, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: String = serde::Deserialize::deserialize(deserializer)?;
    let value = s.trim().to_lowercase();
    // For extremely large values, return a maximum Decimal
    if value.contains('e') && value.contains('+') {
        let parsed_value = value.split('e').collect::<Vec<&str>>()[1]
            .parse::<i32>()
            .unwrap_or(0);
        if parsed_value > 28 {
            return Ok(Decimal::MAX);
        }
        if parsed_value < 0 && parsed_value.abs() > 28 {
            return Ok(Decimal::ZERO);
        }
    }

    // For normal values, regular parsing
    Decimal::from_str(value.as_str())
        .or_else(|_| Decimal::from_scientific(value.as_str()))
        .map_err(|_| de::Error::custom(format!("Failed to parse as Decimal: {}", value)))
}
