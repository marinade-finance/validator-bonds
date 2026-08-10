use super::common::CommonStoreOptions;

use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::MakeTlsConnector;
use tokio_postgres::types::ToSql;
use validator_bonds_common::dto::CollectedStakeRecord;

/// One epoch per collection run: the collector stamps every record from a single `Clock`, and the
/// store replaces that whole epoch. Mixed epochs would make the `DELETE` drop rows it never rewrites.
fn collection_epoch(records: &[CollectedStakeRecord]) -> anyhow::Result<i32> {
    let Some(first) = records.first() else {
        // An empty file must not be allowed to empty the table — the endpoint would silently
        // un-protect every validator.
        anyhow::bail!("No collected stake records to store");
    };
    anyhow::ensure!(
        records.iter().all(|record| record.epoch == first.epoch),
        "Collected stake records span multiple epochs, expected only {}",
        first.epoch
    );
    Ok(first.epoch.try_into()?)
}

pub async fn store_collected_stake(options: CommonStoreOptions) -> anyhow::Result<()> {
    const CHUNK_SIZE: usize = 512;
    const PARAMS_PER_INSERT: usize = 10;

    let input = std::fs::File::open(options.input_path)?;
    let records: Vec<CollectedStakeRecord> = serde_yaml::from_reader(input)?;
    let epoch = collection_epoch(&records)?;

    let mut builder = SslConnector::builder(SslMethod::tls())?;
    builder.set_ca_file(&options.postgres_ssl_root_cert)?;
    let connector = MakeTlsConnector::new(builder.build());

    let (mut psql_client, psql_conn) =
        tokio_postgres::connect(&options.postgres_url, connector).await?;
    tokio::spawn(async move {
        if let Err(err) = psql_conn.await {
            log::error!("PSQL connection terminated: {err}");
        }
    });

    let tx = psql_client.transaction().await?;

    // Replace rather than upsert: a validator that fully unstaked has no record in this run, and a
    // left-behind row would keep reporting stake it no longer has.
    tx.execute("DELETE FROM collected_stake WHERE epoch = $1", &[&epoch])
        .await?;

    for chunk in records.chunks(CHUNK_SIZE) {
        let mut param_index = 1;
        let mut params: Vec<Box<dyn ToSql + Sync + Send>> = Vec::new();
        let mut insert_values = String::new();

        for record in chunk {
            let placeholders = (param_index..param_index + PARAMS_PER_INSERT)
                .map(|index| format!("${index}"))
                .collect::<Vec<_>>()
                .join(", ");
            insert_values.push_str(&format!("({placeholders}),"));
            param_index += PARAMS_PER_INSERT;

            params.push(Box::new(epoch));
            params.push(Box::new(i64::try_from(record.slot)?));
            params.push(Box::new(record.label.clone()));
            params.push(Box::new(record.stake_authority.clone()));
            params.push(Box::new(record.vote_account.clone()));
            params.push(Box::new(i64::try_from(record.effective)?));
            params.push(Box::new(i64::try_from(record.activating)?));
            params.push(Box::new(i64::try_from(record.deactivating)?));
            params.push(Box::new(i32::try_from(record.stake_accounts)?));
            params.push(Box::new(record.updated_at));
        }

        insert_values.pop();

        let query = format!(
            "
            INSERT INTO collected_stake (epoch, slot, label, stake_authority, vote_account, effective, activating, deactivating, stake_accounts, updated_at)
            VALUES {insert_values}
            "
        );

        let params = params
            .iter()
            .map(|param| param.as_ref() as &(dyn ToSql + Sync))
            .collect::<Vec<_>>();
        tx.query(&query, &params).await?;
    }

    tx.commit().await?;
    log::info!(
        "Stored {} collected stake records for epoch {epoch}",
        records.len()
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn record(epoch: u64) -> CollectedStakeRecord {
        CollectedStakeRecord {
            epoch,
            slot: 438413520,
            label: "native".to_string(),
            stake_authority: "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq".to_string(),
            vote_account: "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb".to_string(),
            effective: 1,
            activating: 0,
            deactivating: 0,
            stake_accounts: 1,
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn one_epoch_is_accepted() {
        assert_eq!(
            collection_epoch(&[record(1014), record(1014)]).unwrap(),
            1014
        );
    }

    #[test]
    fn an_empty_collection_is_rejected() {
        collection_epoch(&[]).unwrap_err();
    }

    #[test]
    fn mixed_epochs_are_rejected() {
        let err = collection_epoch(&[record(1014), record(1013)]).unwrap_err();
        assert!(err.to_string().contains("multiple epochs"));
    }
}
