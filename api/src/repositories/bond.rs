use std::collections::HashMap;

use rust_decimal::Decimal;
use tokio_postgres::{types::ToSql, Client, NoTls};

use crate::dto::ValidatorBondRecord;

use super::common::CommonStoreOptions;

pub async fn get_bonds(psql_client: &Client) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    let rows = psql_client
        .query(
            "
            WITH cluster AS (SELECT MAX(epoch) as last_epoch FROM bonds)
            SELECT
                pubkey, vote_account, authority, cpmpe, updated_at, epoch
            FROM bonds, cluster WHERE epoch = cluster.last_epoch",
            &[],
        )
        .await?;

    let mut bonds: Vec<ValidatorBondRecord> = vec![];
    for row in rows {
        bonds.push(ValidatorBondRecord {
            pubkey: row.get("pubkey"),
            vote_account: row.get("vote_account"),
            authority: row.get("authority"),
            epoch: row.get::<_, i32>("epoch").try_into()?,
            cpmpe: row.get::<_, Decimal>("cpmpe"),
            updated_at: row.get("updated_at"),
        })
    }

    Ok(bonds)
}

pub async fn store_bonds(options: CommonStoreOptions) -> anyhow::Result<()> {
    const CHUNK_SIZE: usize = 512;
    const PARAMS_PER_INSERT: usize = 6;

    let (psql_client, psql_conn) = tokio_postgres::connect(&options.postgres_url, NoTls).await?;

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
        }

        insert_values.pop();

        let query = format!(
            "
            INSERT INTO bonds (pubkey, vote_account, authority, epoch, updated_at, cpmpe)
            VALUES {}
            ON CONFLICT (pubkey, epoch) DO UPDATE
            SET vote_account = EXCLUDED.vote_account,
                authority = EXCLUDED.authority,
                updated_at = EXCLUDED.updated_at,
                cpmpe = EXCLUDED.cpmpe
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
