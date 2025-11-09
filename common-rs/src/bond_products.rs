use anchor_client::anchor_lang::AnchorSerialize;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_sdk::bs58;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::bond_product::{BondProduct, ProductType};

use crate::get_validator_bonds_program;
use crate::utils::get_accounts_for_pubkeys;

const CONFIG_ADDRESS_OFFSET: usize = 8;
const BOND_ADDRESS_OFFSET: usize = 40;
const VOTE_ACCOUNT_ADDRESS_OFFSET: usize = 72;
const PRODUCT_TYPE_SEED_OFFSET: usize = 104;

pub async fn get_bond_products(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, BondProduct)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

pub async fn get_bond_products_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<BondProduct>)>> {
    get_accounts_for_pubkeys(rpc_client, pubkeys).await
}

#[derive(Default)]
pub struct FindBondProductsArgs<'a> {
    pub config: Option<&'a Pubkey>,
    pub bond: Option<&'a Pubkey>,
    pub vote_account: Option<&'a Pubkey>,
    pub product_type: Option<&'a ProductType>,
}

pub async fn find_bond_products(
    rpc_client: Arc<RpcClient>,
    args: FindBondProductsArgs<'_>,
) -> anyhow::Result<Vec<(Pubkey, BondProduct)>> {
    // Optimization: if bond and product_type are both provided, directly fetch the PDA
    if let (Some(bond_addr), Some(prod_type)) = (args.bond, args.product_type) {
        use validator_bonds::state::bond_product::find_bond_product_address;

        let (bond_product_pda, _bump) = find_bond_product_address(bond_addr, prod_type);
        let program = get_validator_bonds_program(rpc_client, None)?;

        return match program.account::<BondProduct>(bond_product_pda).await {
            Ok(account) => Ok(vec![(bond_product_pda, account)]),
            Err(_) => Ok(vec![]),
        };
    }

    // Build filters for account scanning
    let mut filters = Vec::new();

    if let Some(config_addr) = args.config {
        filters.push(RpcFilterType::Memcmp(Memcmp::new(
            CONFIG_ADDRESS_OFFSET,
            solana_client::rpc_filter::MemcmpEncodedBytes::Base58(config_addr.to_string()),
        )));
    }

    if let Some(bond_addr) = args.bond {
        filters.push(RpcFilterType::Memcmp(Memcmp::new(
            BOND_ADDRESS_OFFSET,
            solana_client::rpc_filter::MemcmpEncodedBytes::Base58(bond_addr.to_string()),
        )));
    }

    if let Some(vote_addr) = args.vote_account {
        filters.push(RpcFilterType::Memcmp(Memcmp::new(
            VOTE_ACCOUNT_ADDRESS_OFFSET,
            solana_client::rpc_filter::MemcmpEncodedBytes::Base58(vote_addr.to_string()),
        )));
    }

    if let Some(prod_type) = args.product_type {
        filters.push(RpcFilterType::Memcmp(Memcmp::new(
            PRODUCT_TYPE_SEED_OFFSET,
            solana_client::rpc_filter::MemcmpEncodedBytes::Base58(
                bs58::encode(prod_type.try_to_vec()?).into_string(),
            ),
        )));
    }

    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(filters).await?)
}
