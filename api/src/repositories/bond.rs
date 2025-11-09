use super::common::CommonStoreOptions;
use crate::dto::SqlSerializableBondType;

use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::MakeTlsConnector;
use rust_decimal::Decimal;
use std::collections::HashMap;
use tokio_postgres::{types::ToSql, Client};
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

pub async fn get_bonds_by_type(
    psql_client: &Client,
    bond_type: BondType,
) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    get_bonds_query(psql_client, Some(bond_type.into())).await
}

pub async fn get_bonds(psql_client: &Client) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    get_bonds_query(psql_client, None).await
}

async fn get_bonds_query(
    psql_client: &Client,
    bond_type: Option<SqlSerializableBondType>,
) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    let base_query = "
        SELECT *
        FROM bonds
        WHERE epoch = (
            SELECT MAX(epoch)
            FROM bonds
            WHERE 1=1
            {bond_type_filter}
        )
        {bond_type_filter}
    ";

    let (query_string, params): (String, Vec<&(dyn ToSql + Sync)>) = match bond_type {
        Some(ref bt) => {
            let query = base_query.replace("{bond_type_filter}", "AND bond_type = $1");
            (query, vec![bt])
        }
        None => {
            let query = base_query.replace("{bond_type_filter}", "");
            (query, vec![])
        }
    };

    let rows = psql_client.query(&query_string, &params).await?;

    let mut bonds: Vec<ValidatorBondRecord> = vec![];
    for row in rows {
        let bond_type: SqlSerializableBondType = row.get("bond_type");
        bonds.push(ValidatorBondRecord {
            pubkey: row.get("pubkey"),
            vote_account: row.get("vote_account"),
            authority: row.get("authority"),
            epoch: row.get::<_, i32>("epoch").try_into()?,
            cpmpe: row.get::<_, Decimal>("cpmpe"),
            max_stake_wanted: row.get::<_, Decimal>("max_stake_wanted"),
            updated_at: row.get("updated_at"),
            funded_amount: row.get::<_, Decimal>("funded_amount"),
            effective_amount: row.get::<_, Decimal>("effective_amount"),
            remaining_witdraw_request_amount: row
                .get::<_, Decimal>("remaining_witdraw_request_amount"),
            remainining_settlement_claim_amount: row
                .get::<_, Decimal>("remainining_settlement_claim_amount"),
            bond_type: bond_type.into(),
            inflation_commission_bps: row.get("inflation_commission_bps"),
            mev_commission_bps: row.get("mev_commission_bps"),
            block_commission_bps: row.get("block_commission_bps"),
        })
    }

    Ok(bonds)
}

pub async fn store_bonds(options: CommonStoreOptions) -> anyhow::Result<()> {
    const CHUNK_SIZE: usize = 512;
    const PARAMS_PER_INSERT: usize = 15;

    let mut builder = SslConnector::builder(SslMethod::tls())?;
    builder.set_ca_file(&options.postgres_ssl_root_cert)?;
    let connector = MakeTlsConnector::new(builder.build());

    let (psql_client, psql_conn) =
        tokio_postgres::connect(&options.postgres_url, connector).await?;

    tokio::spawn(async move {
        if let Err(err) = psql_conn.await {
            log::error!("Connection error: {}", err);
            std::process::exit(1);
        }
    });

    let input = std::fs::File::open(options.input_path)?;
    let bonds: Vec<ValidatorBondRecord> = serde_yaml::from_reader(input)?;
    let bonds_records: HashMap<_, _> = bonds
        .iter()
        .map(|record| (record.pubkey.clone(), record))
        .collect();
    let epoch = bonds[0].epoch as i32;

    for chunk in bonds_records
        .into_iter()
        .collect::<Vec<_>>()
        .chunks(CHUNK_SIZE)
    {
        let mut param_index = 1;
        let mut params: Vec<Box<dyn ToSql + Sync + Send>> = Vec::new();
        let mut insert_values = String::new();

        for (pubkey, bond) in chunk {
            let placeholders = (param_index..param_index + PARAMS_PER_INSERT)
                .map(|index| format!("${}", index))
                .collect::<Vec<_>>()
                .join(", ");
            insert_values.push_str(&format!("({}),", placeholders));
            param_index += PARAMS_PER_INSERT;

            params.push(Box::new(pubkey));
            params.push(Box::new(&bond.vote_account));
            params.push(Box::new(&bond.authority));
            params.push(Box::new(epoch));
            params.push(Box::new(bond.updated_at));
            params.push(Box::new(bond.cpmpe));
            params.push(Box::new(bond.max_stake_wanted));
            params.push(Box::new(bond.funded_amount));
            params.push(Box::new(bond.effective_amount));
            params.push(Box::new(bond.remaining_witdraw_request_amount));
            params.push(Box::new(bond.remainining_settlement_claim_amount));
            params.push(Box::<SqlSerializableBondType>::new(
                bond.bond_type.clone().into(),
            ));
            params.push(Box::new(bond.inflation_commission_bps));
            params.push(Box::new(bond.mev_commission_bps));
            params.push(Box::new(bond.block_commission_bps));
        }

        insert_values.pop();

        let query = format!(
            "
            INSERT INTO bonds (pubkey, vote_account, authority, epoch, updated_at, cpmpe, max_stake_wanted, funded_amount, effective_amount, remaining_witdraw_request_amount, remainining_settlement_claim_amount, bond_type, inflation_commission_bps, mev_commission_bps, block_commission_bps)
            VALUES {}
            ON CONFLICT (pubkey, epoch) DO UPDATE
            SET vote_account = EXCLUDED.vote_account,
                authority = EXCLUDED.authority,
                updated_at = EXCLUDED.updated_at,
                cpmpe = EXCLUDED.cpmpe,
                max_stake_wanted = EXCLUDED.max_stake_wanted,
                funded_amount = EXCLUDED.funded_amount,
                effective_amount = EXCLUDED.effective_amount,
                remaining_witdraw_request_amount = EXCLUDED.remaining_witdraw_request_amount,
                remainining_settlement_claim_amount = EXCLUDED.remainining_settlement_claim_amount,
                bond_type = EXCLUDED.bond_type,
                inflation_commission_bps = EXCLUDED.inflation_commission_bps,
                mev_commission_bps = EXCLUDED.mev_commission_bps,
                block_commission_bps = EXCLUDED.block_commission_bps
            ",
            insert_values
        );

        let params = params
            .iter()
            .map(|param| param.as_ref() as &(dyn ToSql + Sync))
            .collect::<Vec<_>>();
        psql_client.query(&query, &params).await?;
    }

    Ok(())
}
