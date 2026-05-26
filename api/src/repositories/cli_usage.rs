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

pub struct CliUsageParams {
    pub account: Option<String>,
    pub operation: Option<String>,
    pub cli_version: Option<String>,
    pub cli_type: Option<CliType>,
}

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
