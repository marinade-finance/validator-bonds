use crate::arguments::GlobalOpts;
use env_logger::{Builder, Env};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_transaction_executor::{
    SendTransactionWithGrowingTipProvider, TipPolicy, TransactionExecutor,
    TransactionExecutorBuilder,
};
use std::sync::Arc;

pub fn init_log(global_opts: &GlobalOpts) {
    let verbosity = if global_opts.verbose { "debug" } else { "info" };
    let mut builder = Builder::from_env(Env::default().default_filter_or(verbosity));
    builder.init();
}

pub fn get_executor(rpc_client: Arc<RpcClient>, tip_policy: TipPolicy) -> Arc<TransactionExecutor> {
    let transaction_executor_builder = TransactionExecutorBuilder::new()
        .with_default_providers(rpc_client.clone())
        .with_send_transaction_provider(SendTransactionWithGrowingTipProvider {
            rpc_url: rpc_client.url().clone(),
            query_param: "tip".into(),
            tip_policy,
        });
    Arc::new(transaction_executor_builder.build())
}
