use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::error::Error;
use tokio_postgres::types::{FromSql, IsNull, ToSql, Type};
use tokio_postgres::Client;
use utoipa::ToSchema;

/// CLI type enum: 'sam' (SAM/bidding) or 'institutional'
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CliType {
    Sam,
    Institutional,
}

impl ToSql for CliType {
    fn to_sql(
        &self,
        ty: &Type,
        out: &mut tokio_postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        let s = match self {
            CliType::Sam => "sam",
            CliType::Institutional => "institutional",
        };
        s.to_sql(ty, out)
    }

    fn accepts(ty: &Type) -> bool {
        ty.name() == "cli_type" || <&str as ToSql>::accepts(ty)
    }

    fn to_sql_checked(
        &self,
        ty: &Type,
        out: &mut tokio_postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        if !<Self as ToSql>::accepts(ty) {
            return Err(format!("Cannot convert CliType to {}", ty.name()).into());
        }
        self.to_sql(ty, out)
    }
}

impl<'a> FromSql<'a> for CliType {
    fn from_sql(ty: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn Error + Sync + Send>> {
        let s = <&str as FromSql>::from_sql(ty, raw)?;
        match s {
            "sam" => Ok(CliType::Sam),
            "institutional" => Ok(CliType::Institutional),
            _ => Err(format!("Unknown CLI type: {s}").into()),
        }
    }

    fn accepts(ty: &Type) -> bool {
        ty.name() == "cli_type" || <&str as FromSql>::accepts(ty)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CliAnnouncementRecord {
    pub id: i64,
    #[schema(format = "datetime")]
    pub created_at: DateTime<Utc>,
    #[schema(format = "datetime")]
    pub updated_at: DateTime<Utc>,
    pub group_id: i32,
    pub group_order: i32,
    pub title: Option<String>,
    pub text: String,
    pub enabled: bool,
    pub operation_filter: Option<String>,
    pub account_filter: Option<String>,
    pub type_filter: Option<CliType>,
}

pub struct AnnouncementQueryParams {
    pub account: Option<String>,
    pub operation: Option<String>,
    pub cli_type: Option<CliType>,
}

/// Fetches active announcements.
/// This works with the maximum group_id in the table, choosing enabled, possibly filtered
/// and order by group_order ASC. Can return an empty vec.
///
/// operation_filter supports comma-separated prefixes:
/// - "configure" matches "configure-bond", "configure-config", etc.
/// - "configure-bond" matches only "configure-bond"
/// - "configure,fund" matches anything starting with "configure" or "fund"
pub async fn get_active_announcements(
    psql_client: &Client,
    params: AnnouncementQueryParams,
) -> anyhow::Result<Vec<CliAnnouncementRecord>> {
    let query = r#"
        SELECT
            id, created_at, updated_at, group_id, group_order,
            title, text, enabled, operation_filter, account_filter, type_filter
        FROM cli_announcements
        WHERE
            group_id = (SELECT MAX(group_id) FROM cli_announcements)
            AND enabled = TRUE
            AND (operation_filter IS NULL OR EXISTS (
                SELECT 1 FROM unnest(string_to_array(operation_filter, ',')) AS prefix
                WHERE $1 LIKE trim(prefix) || '%'
            ))
            AND (account_filter IS NULL OR account_filter = $2)
            AND (type_filter IS NULL OR type_filter = $3)
        ORDER BY group_order ASC
    "#;

    let rows = psql_client
        .query(
            query,
            &[&params.operation, &params.account, &params.cli_type],
        )
        .await?;

    let announcements: Vec<CliAnnouncementRecord> = rows
        .iter()
        .map(|row| CliAnnouncementRecord {
            id: row.get("id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            group_id: row.get("group_id"),
            group_order: row.get("group_order"),
            title: row.get("title"),
            text: row.get("text"),
            enabled: row.get("enabled"),
            operation_filter: row.get("operation_filter"),
            account_filter: row.get("account_filter"),
            type_filter: row.get("type_filter"),
        })
        .collect();

    Ok(announcements)
}

pub struct CliUsageParams {
    pub account: Option<String>,
    pub operation: Option<String>,
    pub cli_version: Option<String>,
    pub cli_type: Option<CliType>,
}

/// This is called when a validator uses the CLI (via announcements endpoint).
pub async fn record_cli_usage(psql_client: &Client, params: CliUsageParams) -> anyhow::Result<()> {
    let query = r#"
        INSERT INTO cli_usage (account, operation, cli_version, cli_type)
        VALUES ($1, $2, $3, $4)
    "#;

    psql_client
        .execute(
            query,
            &[
                &params.account,
                &params.operation,
                &params.cli_version,
                &params.cli_type,
            ],
        )
        .await?;

    Ok(())
}
