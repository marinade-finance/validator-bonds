use crate::commands::common::CommonCollectOptions;
use crate::{dto::ValidatorBondRecord, utils::rpc::get_rpc_client};
use anchor_lang::{AccountDeserialize, Discriminator};
use serde_yaml;
use solana_account_decoder::UiAccountEncoding;
use solana_client::{
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::Memcmp,
};
use validator_bonds::constants::PROGRAM_ID;
use validator_bonds::state::bond::Bond;

pub async fn collect_bonds(options: CommonCollectOptions) -> anyhow::Result<()> {
    let client = &get_rpc_client(options.rpc_url, options.commitment.to_string());

    let updated_at = chrono::Utc::now();
    let current_epoch_info = client.get_epoch_info().await?;
    let epoch = current_epoch_info.epoch;

    let mut bonds: Vec<ValidatorBondRecord> = vec![];
    let bonds_program = PROGRAM_ID.try_into()?;
    let bond_accounts = client
        .get_program_accounts_with_config(
            &bonds_program,
            RpcProgramAccountsConfig {
                filters: Some(vec![solana_client::rpc_filter::RpcFilterType::Memcmp(
                    Memcmp::new_base58_encoded(0, &Bond::DISCRIMINATOR),
                )]),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    data_slice: None,
                    commitment: None,
                    min_context_slot: None,
                },
                with_context: None,
            },
        )
        .await?;

    for bond_account in bond_accounts {
        let bond: Bond = AccountDeserialize::try_deserialize(&mut bond_account.1.data.as_slice())?;
        bonds.push(ValidatorBondRecord {
            pubkey: bond_account.0.to_string(),
            vote_account: bond.vote_account.to_string(),
            authority: bond.authority.to_string(),
            cpmpe: bond.cpmpe.try_into().unwrap(),
            epoch,
            updated_at,
        })
    }

    serde_yaml::to_writer(std::io::stdout(), &bonds)?;

    Ok(())
}
