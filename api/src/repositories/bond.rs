use super::common::{pg_transient, CommonStoreOptions};
use crate::dto::SqlSerializableBondType;

use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::MakeTlsConnector;
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use tokio_postgres::{types::ToSql, Client};
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

/// ds-sam-calc relay from bonds-eventing: per-validator calc blobs (keyed by vote
/// account) + the per-epoch meta. Untyped — the CLI's ds-sam-calc owns the shape.
#[derive(Default)]
pub struct AuctionContext {
    pub meta: Option<Value>,
    pub validators: HashMap<String, Value>,
}

pub async fn get_auction_context(
    psql_client: &Client,
    bond_type: BondType,
) -> anyhow::Result<AuctionContext> {
    let sql_bond_type: SqlSerializableBondType = bond_type.into();

    // One statement → one snapshot: meta and the per-validator blobs can't come from two
    // different auctions, and validators are pinned to the meta epoch so a partially-saved
    // (failed-event) validator's stale-epoch blob is excluded from the reconstructed result.
    let rows = psql_client
        .query(
            "SELECT
               (SELECT data FROM bond_event_meta WHERE bond_type = $1) AS meta,
               (SELECT json_object_agg(vote_account, auction_validator)
                  FROM bond_event_state
                  WHERE bond_type = $1
                    AND auction_validator IS NOT NULL
                    AND epoch = (SELECT epoch FROM bond_event_meta WHERE bond_type = $1)
               ) AS validators",
            &[&sql_bond_type],
        )
        .await?;

    let Some(row) = rows.first() else {
        return Ok(AuctionContext::default());
    };

    let meta = row.get::<_, Option<Value>>("meta");
    let validators = match row.get::<_, Option<Value>>("validators") {
        Some(Value::Object(map)) => map.into_iter().collect(),
        _ => HashMap::new(),
    };

    Ok(AuctionContext { meta, validators })
}

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
    rows.into_iter().map(map_bond_row).collect()
}

/// Both configs at one epoch. `/v1/validators/protected` sums their collateral, and each type is
/// stored by its own pipeline run, so a per-type `MAX(epoch)` could sum two different epochs.
pub async fn get_summable_bonds(psql_client: &Client) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    let bidding: SqlSerializableBondType = BondType::Bidding.into();
    let institutional: SqlSerializableBondType = BondType::Institutional.into();

    let rows = psql_client
        .query(
            "SELECT *
             FROM bonds
             WHERE bond_type IN ($1, $2)
               AND epoch = (
                   SELECT MIN(newest) FROM (
                       SELECT MAX(epoch) AS newest
                       FROM bonds
                       WHERE bond_type IN ($1, $2)
                       GROUP BY bond_type
                   ) newest_per_type
               )",
            &[&bidding, &institutional],
        )
        .await?;
    rows.into_iter().map(map_bond_row).collect()
}

fn map_bond_row(row: tokio_postgres::Row) -> anyhow::Result<ValidatorBondRecord> {
    let bond_type: SqlSerializableBondType = row.get("bond_type");
    Ok(ValidatorBondRecord {
        pubkey: row.get("pubkey"),
        vote_account: row.get("vote_account"),
        authority: row.get("authority"),
        epoch: row.get::<_, i32>("epoch").try_into()?,
        cpmpe: row.get::<_, Decimal>("cpmpe"),
        max_stake_wanted: row.get::<_, Decimal>("max_stake_wanted"),
        updated_at: row.get("updated_at"),
        funded_amount: row.get::<_, Decimal>("funded_amount"),
        effective_amount: row.get::<_, Decimal>("effective_amount"),
        remaining_witdraw_request_amount: row.get::<_, Decimal>("remaining_witdraw_request_amount"),
        remainining_settlement_claim_amount: row
            .get::<_, Decimal>("remainining_settlement_claim_amount"),
        bond_type: bond_type.into(),
        inflation_commission_bps: row.get("inflation_commission_bps"),
        mev_commission_bps: row.get("mev_commission_bps"),
        block_commission_bps: row.get("block_commission_bps"),
    })
}

pub async fn store_bonds(options: CommonStoreOptions) -> anyhow::Result<()> {
    const CHUNK_SIZE: usize = 512;
    const PARAMS_PER_INSERT: usize = 15;

    let mut builder = SslConnector::builder(SslMethod::tls())?;
    builder.set_ca_file(&options.postgres_ssl_root_cert)?;
    let connector = MakeTlsConnector::new(builder.build());

    let (mut psql_client, psql_conn) = tokio_postgres::connect(&options.postgres_url, connector)
        .await
        .map_err(pg_transient)?;

    tokio::spawn(async move {
        if let Err(err) = psql_conn.await {
            log::error!("PSQL connection terminated: {err}");
        }
    });

    let input = std::fs::File::open(options.input_path)?;
    let bonds: Vec<ValidatorBondRecord> = serde_yaml::from_reader(input)?;
    let bonds_records: HashMap<_, _> = bonds
        .iter()
        .map(|record| (record.pubkey.clone(), record))
        .collect();
    let epoch = bonds[0].epoch as i32;

    // Readers pin epoch = MAX(epoch), so a half-written epoch hides the previous complete one.
    let tx = psql_client.transaction().await.map_err(pg_transient)?;

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
                .map(|index| format!("${index}"))
                .collect::<Vec<_>>()
                .join(", ");
            insert_values.push_str(&format!("({placeholders}),"));
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
            VALUES {insert_values}
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
            "
        );

        let params = params
            .iter()
            .map(|param| param.as_ref() as &(dyn ToSql + Sync))
            .collect::<Vec<_>>();
        tx.query(&query, &params).await.map_err(pg_transient)?;
    }

    tx.commit().await.map_err(pg_transient)?;

    Ok(())
}
