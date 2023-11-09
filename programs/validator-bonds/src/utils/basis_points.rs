use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use std::fmt::Display;

#[cfg(feature = "no-entrypoint")]
use std::num::ParseFloatError;
#[cfg(feature = "no-entrypoint")]
use std::str::FromStr;

/// It's a smaller unit of a basis point (basis point = 1/100%), we calculate 1/10_000% here instead.
/// The max value is 1_000_000 (100%).
/// 1 HundredthBasisPoint = 0.0001%, 10_000 HundredthBasisPoint = 1%, 1_000_000 HundredthBasisPoint = 100%.
#[derive(
    Clone, Copy, Debug, Default, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, PartialOrd, Ord,
)]
pub struct HundredthBasisPoint {
    pub hundredth_bps: u32,
}

impl HundredthBasisPoint {
    const DIVIDER: u32 = 10_000;
    const MAX_BPS: u32 = 1_000_000;
    pub const MAX_HUNDREDTH_BPS: HundredthBasisPoint = HundredthBasisPoint {
        hundredth_bps: HundredthBasisPoint::MAX_BPS,
    }; // 100%

    pub fn from_hundredth_bp(hundredth_bps: u32) -> Result<Self> {
        let initialized = Self { hundredth_bps };
        initialized.check()
    }

    pub fn check(self) -> Result<Self> {
        require_gte!(
            &Self::MAX_HUNDREDTH_BPS,
            &self,
            ErrorCode::HundrethBasisPointsOverflow
        );
        Ok(self)
    }

    pub fn apply(&self, lamports: u64) -> u64 {
        (lamports as u128 * self.hundredth_bps as u128
            / Self::MAX_HUNDREDTH_BPS.hundredth_bps as u128) as u64
    }
}

impl Display for HundredthBasisPoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}.{:0>4}%",
            self.hundredth_bps / HundredthBasisPoint::DIVIDER,
            self.hundredth_bps % HundredthBasisPoint::DIVIDER
        )
    }
}

/// Parsing from string considering the input being in percents.
#[cfg(feature = "no-entrypoint")]
impl TryFrom<f64> for HundredthBasisPoint {
    type Error = Error;

    fn try_from(n: f64) -> Result<Self> {
        let hundredth_bps_i = (n * HundredthBasisPoint::DIVIDER as f64).floor() as i64; // 4.5% => 45000 bp_cents
        let hundredths_bps = u32::try_from(hundredth_bps_i).map_err(|_| {
            error!(ErrorCode::HundrethBasisPointsCalculation)
                .with_values(("hundredth_bps_i", hundredth_bps_i))
        })?;
        Ok(HundredthBasisPoint::from_hundredth_bp(hundredths_bps)?)
    }
}

#[cfg(feature = "no-entrypoint")]
impl FromStr for HundredthBasisPoint {
    type Err = ParseHundredthBasisPointError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        let parsed_s =
            s.parse::<f64>()
                .map_err(|e: ParseFloatError| ParseHundredthBasisPointError {
                    parsed_data: s.to_string(),
                    reason: e.to_string(),
                })?;

        let result = f64::try_into(parsed_s).map_err(|e: Error| ParseHundredthBasisPointError {
            parsed_data: s.to_string(),
            reason: e.to_string(),
        })?;

        Ok(result)
    }
}

#[cfg(feature = "no-entrypoint")]
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ParseHundredthBasisPointError {
    pub parsed_data: String,
    pub reason: String,
}

#[cfg(feature = "no-entrypoint")]
impl Display for ParseHundredthBasisPointError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        format!(
          "provided string {} was not a number that being of type f64 and in range of 0 and 1_000_000, reason: {}",
          self.parsed_data, self.reason
        ).fmt(f)
    }
}

#[cfg(feature = "no-entrypoint")]
impl std::error::Error for ParseHundredthBasisPointError {
    #[allow(deprecated)]
    fn description(&self) -> &str {
        "failed to parse hundredth basis point"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hundred_points_from_u32_limit_match() {
        HundredthBasisPoint::from_hundredth_bp(1_000_000).unwrap();
        HundredthBasisPoint::from_hundredth_bp(0).unwrap();
        HundredthBasisPoint::from_hundredth_bp(u32::MIN).unwrap();
        HundredthBasisPoint::from_hundredth_bp(42).unwrap();
        HundredthBasisPoint::from_hundredth_bp(999_999).unwrap();

        HundredthBasisPoint::from_hundredth_bp(1_000_001).unwrap_err();
        HundredthBasisPoint::from_hundredth_bp(u32::MAX).unwrap_err();
    }

    #[test]
    fn hundred_points_struct_limit_match() {
        HundredthBasisPoint {
            hundredth_bps: 1_000_000,
        }
        .check()
        .unwrap();
        HundredthBasisPoint { hundredth_bps: 0 }.check().unwrap();
        HundredthBasisPoint {
            hundredth_bps: 1000,
        }
        .check()
        .unwrap();
        HundredthBasisPoint {
            hundredth_bps: u32::MAX - 1,
        }
        .check()
        .unwrap_err();
    }

    #[cfg(feature = "no-entrypoint")]
    #[test]
    fn hundred_points_from_str_limit_match() {
        HundredthBasisPoint::from_str("100").unwrap();
        HundredthBasisPoint::from_str("0").unwrap();
        HundredthBasisPoint::from_str("42.23").unwrap();
        HundredthBasisPoint::from_str("99.999").unwrap();
        HundredthBasisPoint::from_str("100.1").unwrap_err();
        HundredthBasisPoint::from_str(&u32::MAX.to_string()).unwrap_err();
    }

    #[test]
    fn hundred_points_calculate() {
        // have 0%
        let calculator = HundredthBasisPoint::from_hundredth_bp(0).unwrap();
        assert_eq!(calculator.apply(100), 0);
        assert_eq!(calculator.apply(321), 0);

        // have 10%
        let calculator = HundredthBasisPoint::from_hundredth_bp(100_000).unwrap();
        assert_eq!(calculator.apply(100), 10);
        assert_eq!(calculator.apply(123456), 12345);
        assert_eq!(
            calculator.apply(100_000_000_000_000_001),
            10_000_000_000_000_000
        );

        // have 100%
        let calculator = HundredthBasisPoint::MAX_HUNDREDTH_BPS;
        assert_eq!(calculator.apply(100), 100);
        assert_eq!(calculator.apply(99), 99);
    }
}
