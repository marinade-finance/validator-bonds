use structopt::StructOpt;

#[derive(Debug, StructOpt)]
pub struct CommonStoreOptions {
    #[structopt(long = "input-file")]
    pub input_path: String,

    #[structopt(long = "postgres-url")]
    pub postgres_url: String,

    #[structopt(long = "postgres-ssl-root-cert", env = "PG_SSLROOTCERT")]
    pub postgres_ssl_root_cert: String,
}
