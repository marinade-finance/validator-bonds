use crate::constants::BOND_PRODUCT_SEED;
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;

// considering reasonable to allocate some additional space for future upgrades of data structs
pub const ADDITIONAL_ACCOUNT_INIT_SPACE: usize = 100;
const MAX_BASIS_POINTS: i64 = 10_000;

/// Product type discriminator
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ProductType {
    Commission,
    /// for future extensibility without program upgrade
    Custom(String),
}

impl ProductType {
    pub fn to_seed(&self) -> &[u8] {
        match self {
            ProductType::Commission => b"commission",
            ProductType::Custom(name) => name.as_bytes(),
        }
    }
}

/// Trait for validating product configurations
pub trait ValidateProductTypeConfig {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

/// Discriminated union for different product configurations
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum ProductTypeConfig {
    Commission(CommissionProductConfig),
    /// Raw bytes for custom/future product types
    Custom(Vec<u8>),
}

impl ValidateProductTypeConfig for ProductTypeConfig {
    fn validate(&self) -> Result<()> {
        match self {
            ProductTypeConfig::Commission(config) => config.validate(),
            ProductTypeConfig::Custom(_) => Ok(()),
        }
    }
}

impl ProductTypeConfig {
    pub fn default_by_type(product_type: &ProductType) -> Result<Self> {
        match product_type {
            ProductType::Commission => Ok(ProductTypeConfig::Commission(
                CommissionProductConfig::default(),
            )),
            ProductType::Custom(_) => Err(error!(ErrorCode::ProductTypeConfigValidationFailure)
                .with_values(("reason", "No default for custom product type"))),
        }
    }
}

/// Configuration of commissions. The commission is permitted to be negative to allow for subsidies.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct CommissionProductConfig {
    pub inflation_bps: Option<i64>,
    pub mev_bps: Option<i64>,
    pub block_bps: Option<i64>,
}

impl ValidateProductTypeConfig for CommissionProductConfig {
    fn validate(&self) -> Result<()> {
        if let Some(bps) = self.inflation_bps {
            if bps > MAX_BASIS_POINTS {
                return Err(error!(ErrorCode::ProductTypeConfigValidationFailure)
                    .with_values(("inflation_bps", bps))
                    .with_values(("max", MAX_BASIS_POINTS)));
            }
        }
        if let Some(bps) = self.mev_bps {
            if bps > MAX_BASIS_POINTS {
                return Err(error!(ErrorCode::ProductTypeConfigValidationFailure)
                    .with_values(("mev_bps", bps))
                    .with_values(("max", MAX_BASIS_POINTS)));
            }
        }
        if let Some(bps) = self.block_bps {
            if bps > MAX_BASIS_POINTS {
                return Err(error!(ErrorCode::ProductTypeConfigValidationFailure)
                    .with_values(("block_bps", bps))
                    .with_values(("max", MAX_BASIS_POINTS)));
            }
        }
        Ok(())
    }
}

/// Bond products configuration.
/// Validator configures different products on a bond to offer various staking services.
#[account]
#[derive(Debug)]
pub struct BondProduct {
    /// The bond config account
    pub config: Pubkey,
    /// The bond this product belongs to
    pub bond: Pubkey,
    /// Validator vote account this product is associated with
    pub vote_account: Pubkey,
    /// Product type discriminator
    pub product_type: ProductType,
    /// Type-specific configuration data
    pub config_data: ProductTypeConfig,
    /// Bump seed
    pub bump: u8,
}

impl BondProduct {
    pub fn address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                BOND_PRODUCT_SEED,
                self.bond.key().as_ref(),
                self.product_type.to_seed(),
                &[self.bump],
            ],
            &ID,
        )
        .map_err(|_| crate::error::ErrorCode::InvalidBondProductAddress.into())
    }
}

impl BondProduct {
    pub const DISCRIMINATOR_LEN: usize = 8;
    pub const ENUM_DISCRIMINATOR_LEN: usize = 1;

    /// Calculate total space needed for this product
    pub fn calculate_space(product_type: &ProductType, config_data: &ProductTypeConfig) -> usize {
        Self::DISCRIMINATOR_LEN
            + 32 + 32 + 32 + 1 // pubkeys + bump
            + Self::product_type_size(product_type)
            + Self::config_data_size(config_data)
            + ADDITIONAL_ACCOUNT_INIT_SPACE
    }

    fn product_type_size(product_type: &ProductType) -> usize {
        Self::ENUM_DISCRIMINATOR_LEN
            + match product_type {
                ProductType::Commission => 0, // No additional data
                ProductType::Custom(name) => {
                    4 + name.len() // string length (u32) + string bytes
                }
            }
    }

    fn config_data_size(config_data: &ProductTypeConfig) -> usize {
        Self::ENUM_DISCRIMINATOR_LEN
            + match config_data {
                ProductTypeConfig::Commission(_) => std::mem::size_of::<CommissionProductConfig>(),
                ProductTypeConfig::Custom(bytes) => {
                    // https://internals.rust-lang.org/t/optimizing-layout-of-nested-enums/5098
                    // "we often end up reserving 4 or 8 bytes for an enum discriminant"
                    8 + 4 + bytes.len() // nested enum serialization reserve + vec length prefix (u32) + data bytes
                }
            }
    }
}

pub fn find_bond_product_address(bond: &Pubkey, product_type: &ProductType) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            BOND_PRODUCT_SEED,
            bond.key().as_ref(),
            product_type.to_seed(),
        ],
        &ID,
    )
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::collection::vec;
    use proptest::option;
    use proptest::prelude::*;

    fn commission() -> impl Strategy<Value = CommissionProductConfig> {
        let bps = || {
            option::of(prop_oneof![
                any::<i64>(),
                -20_000i64..20_000,
                9_990i64..10_010
            ])
        };
        (bps(), bps(), bps()).prop_map(|(inflation_bps, mev_bps, block_bps)| {
            CommissionProductConfig {
                inflation_bps,
                mev_bps,
                block_bps,
            }
        })
    }

    fn pairs() -> impl Strategy<Value = (ProductType, ProductTypeConfig)> {
        prop_oneof![
            commission().prop_map(|c| (ProductType::Commission, ProductTypeConfig::Commission(c))),
            (".{0,40}", vec(any::<u8>(), 0..300))
                .prop_map(|(n, b)| (ProductType::Custom(n), ProductTypeConfig::Custom(b))),
        ]
    }

    proptest! {
        #[test]
        fn allocated_space_covers_serialized_account((pt, cfg) in pairs(), bump in any::<u8>()) {
            let product = BondProduct {
                config: Pubkey::new_unique(),
                bond: Pubkey::new_unique(),
                vote_account: Pubkey::new_unique(),
                product_type: pt.clone(),
                config_data: cfg.clone(),
                bump,
            };
            let mut data = Vec::new();
            product.try_serialize(&mut data).unwrap();
            prop_assert!(BondProduct::calculate_space(&pt, &cfg) >= data.len());
        }

        #[test]
        fn config_survives_reconfiguration_in_place(old in commission(), new in commission()) {
            // reconfiguring a commission product never needs more space than allocated at init
            let pt = ProductType::Commission;
            let init = BondProduct::calculate_space(&pt, &ProductTypeConfig::Commission(old));
            let later = BondProduct::calculate_space(&pt, &ProductTypeConfig::Commission(new.clone()));
            prop_assert_eq!(init, later);
            let mut ser = Vec::new();
            new.serialize(&mut ser).unwrap();
            prop_assert!(ser.len() + BondProduct::DISCRIMINATOR_LEN <= init);
        }

        #[test]
        fn validate_rejects_exactly_above_max(c in commission()) {
            let over = |v: Option<i64>| v.is_some_and(|b| b > MAX_BASIS_POINTS);
            let expect_err = over(c.inflation_bps) || over(c.mev_bps) || over(c.block_bps);
            prop_assert_eq!(c.validate().is_err(), expect_err);
            prop_assert_eq!(ProductTypeConfig::Commission(c).validate().is_err(), expect_err);
        }

        #[test]
        fn config_roundtrips_through_borsh((_pt, cfg) in pairs()) {
            let mut ser = Vec::new();
            cfg.serialize(&mut ser).unwrap();
            let back = ProductTypeConfig::deserialize(&mut ser.as_slice()).unwrap();
            let mut ser2 = Vec::new();
            back.serialize(&mut ser2).unwrap();
            prop_assert_eq!(ser, ser2);
        }
    }
}
