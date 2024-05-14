use crate::bonds::get_bonds_for_pubkeys;
use crate::get_validator_bonds_program;

use crate::utils::get_accounts_for_pubkeys;

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use std::sync::Arc;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::settlement::Settlement;

pub async fn get_settlements(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

pub async fn get_settlements_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<Settlement>)>> {
    get_accounts_for_pubkeys(rpc_client, pubkeys).await
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
