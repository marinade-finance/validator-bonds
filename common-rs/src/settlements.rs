use crate::bonds::get_bonds_for_pubkeys;
use crate::get_validator_bonds_program;
use crate::settlement_claims::SettlementClaimsBitmap;
use crate::utils::{get_account_infos_for_pubkeys, get_accounts_for_pubkeys};
use anyhow::anyhow;
use log::{debug, error};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::settlement::{find_settlement_claims_address, Settlement};

pub async fn get_settlements(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

/// Loading settlements for a given config address
/// Settlement account is associated with a Bond account
/// The Bond account is associated with a Config account (i.e., the config address)
pub async fn get_settlements_for_config(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let all_settlements = get_settlements(rpc_client.clone()).await?;

    let settlement_bonds = all_settlements
        .iter()
        .map(|(_, settlement)| settlement.bond)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<Pubkey>>();
    let bonds = get_bonds_for_pubkeys(rpc_client.clone(), &settlement_bonds).await?;
    let bonds_map = bonds.into_iter()
        .map(|(pubkey, bond)| {
            if let Some(bond) = bond {
                Ok((pubkey, bond))
            } else {
                Err(anyhow!("Bond not found for Settlement: {}. The Bond account existence for a Settlement is the program invariant", pubkey))
            }
        })
        .collect::<anyhow::Result<HashMap<_, _>>>()?;

    debug!(
        "Found {} bonds for {} settlements for program id {}",
        bonds_map.len(),
        all_settlements.len(),
        validator_bonds::ID
    );

    let config_settlements = all_settlements
        .into_iter()
        .filter(|(settlement_pubkey, settlement)| {
            if let Some(bond) = bonds_map.get(&settlement.bond) {
                bond.config == *config_address
            } else {
                error!(
                    "Bond {} not found for Settlement: {}",
                    settlement.bond, settlement_pubkey
                );
                false
            }
        })
        .collect::<Vec<(Pubkey, Settlement)>>();

    debug!(
        "Filtered for {} settlements for program id {} and config id {}",
        config_settlements.len(),
        validator_bonds::ID,
        config_address
    );

    Ok(config_settlements)
}

pub async fn get_settlements_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<Settlement>)>> {
    get_accounts_for_pubkeys(rpc_client, pubkeys).await
}

/// settlement address, settlement claims address, settlement claims bitmap
pub async fn get_settlement_claims_for_settlement_pubkeys(
    rpc_client: Arc<RpcClient>,
    settlement_pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Pubkey, Option<SettlementClaimsBitmap>)>> {
    let settlement_claims_pubkeys = settlement_pubkeys
        .iter()
        .map(|settlement_pubkey| find_settlement_claims_address(settlement_pubkey).0)
        .collect::<Vec<Pubkey>>();
    let settlement_claims = get_account_infos_for_pubkeys(rpc_client, &settlement_claims_pubkeys)
        .await?
        .into_iter()
        .map(|(pubkey, account)| {
            if let Some(account) = account {
                Ok((pubkey, Some(SettlementClaimsBitmap::new(account)?)))
            } else {
                Ok((pubkey, None))
            }
        })
        .collect::<anyhow::Result<
            Vec<(
                Pubkey,
                Option<crate::settlement_claims::SettlementClaimsBitmap>,
            )>,
        >>()?;
    let result = settlement_pubkeys
        .iter()
        .zip(settlement_claims.into_iter())
        .map(
            |(settlement_pubkey, (settlement_claims_pubkey, settlement_claims_bitmap))| {
                (
                    *settlement_pubkey,
                    settlement_claims_pubkey,
                    settlement_claims_bitmap,
                )
            },
        )
        .collect::<Vec<(Pubkey, Pubkey, Option<SettlementClaimsBitmap>)>>();
    Ok(result)
}

pub async fn get_bonds_for_settlements(
    rpc_client: Arc<RpcClient>,
    settlements: &[(Pubkey, Settlement)],
) -> anyhow::Result<Vec<(Pubkey, Option<Bond>)>> {
    let bond_pubkeys = settlements
        .iter()
        .map(|(_, settlement)| settlement.bond)
        .collect::<HashSet<_>>() // be unique
        .into_iter()
        .collect::<Vec<Pubkey>>();

    let bonds = get_bonds_for_pubkeys(rpc_client, &bond_pubkeys).await?;

    let settlements_bonds = settlements
        .iter()
        .map(|(pubkey, settlement)| {
            bonds
                .iter()
                .find(|(bond_pubkey, bond)| bond_pubkey == pubkey && bond.is_some())
                .map_or_else(
                    || (settlement.bond, None),
                    |(_, bond)| {
                        if let Some(bond) = bond {
                            (settlement.bond, Some(bond.clone()))
                        } else {
                            (settlement.bond, None)
                        }
                    },
                )
        })
        .collect();

    Ok(settlements_bonds)
}
