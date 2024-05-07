use crate::get_validator_bonds_program;
use anyhow::anyhow;
use solana_account_decoder::UiDataSliceConfig;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcAccountInfoConfig;
use solana_program::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::settlement_claim::SettlementClaim;

pub async fn get_settlement_claims(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, SettlementClaim)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

pub async fn collect_existence_settlement_claims_from_addresses(
    rpc_client: Arc<RpcClient>,
    settlement_claim_addresses: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, bool)>> {
    let settlement_claim_addresses_chunked = settlement_claim_addresses
        // permitted to fetch 100 accounts at once; https://solana.com/docs/rpc/http/getmultipleaccounts
        .chunks(100)
        .collect::<Vec<&[Pubkey]>>();
    let mut settlement_claims: Vec<(Pubkey, bool)> = vec![];
    for address_chunk in settlement_claim_addresses_chunked.iter() {
        let accounts = rpc_client
            .get_multiple_accounts_with_config(
                address_chunk,
                RpcAccountInfoConfig {
                    data_slice: Some(UiDataSliceConfig {
                        offset: 0,
                        length: 0,
                    }),
                    ..RpcAccountInfoConfig::default()
                },
            )
            .await
            .map_err(|e| anyhow!("Error fetching settlement claim accounts: {:?}", e))?;
        accounts
            .value
            .iter()
            .zip(address_chunk.iter())
            .for_each(|(a, p)| {
                settlement_claims.push((*p, a.is_some()));
            });
    }
    Ok(settlement_claims)
}
