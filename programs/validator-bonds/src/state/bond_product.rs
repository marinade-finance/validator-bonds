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
            ProductType::Commission => Ok(ProductTypeConfig::Commission(CommissionProductConfig {
                inflation_bps: None,
                mev_bps: None,
                block_bps: None,
            })),
            ProductType::Custom(_) => Err(error!(ErrorCode::ProductTypeConfigValidationFailure)
                .with_values(("reason", "No default for custom product type"))),
        }
    }
}

/// Configuration of commissions. The commission is permitted to be negative to allow for subsidies.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
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
