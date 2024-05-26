use solana_client::nonblocking::rpc_client::RpcClient;
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_builder_executor::{
    builder_to_execution_data, execute_transactions_in_parallel, execute_transactions_in_sequence,
};
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::sync::Arc;

const PARALLEL_EXECUTION_RATE_DEFAULT: usize = 100;

pub async fn execute_parallel(
    rpc_client: Arc<RpcClient>,
    executor: Arc<TransactionExecutor>,
    builder: &mut TransactionBuilder,
    priority_fee_policy: &PriorityFeePolicy,
) -> anyhow::Result<(usize, usize)> {
    execute_parallel_with_rate(
        rpc_client,
        executor,
        builder,
        priority_fee_policy,
        PARALLEL_EXECUTION_RATE_DEFAULT,
    )
    .await
}

pub async fn execute_parallel_with_rate(
    rpc_client: Arc<RpcClient>,
    executor: Arc<TransactionExecutor>,
    builder: &mut TransactionBuilder,
    priority_fee_policy: &PriorityFeePolicy,
    parallel_execution_rate: usize,
) -> anyhow::Result<(usize, usize)> {
    let executed_instruction_count = builder.instructions().len();
    let execution_data =
        builder_to_execution_data(rpc_client.url(), builder, Some(priority_fee_policy.clone()));
    let executed_transaction_count = execution_data.len();
    execute_transactions_in_parallel(
        executor.clone(),
        execution_data,
        Some(parallel_execution_rate),
    )
    .await?;
    // when all executed successfully then builder should be empty
    assert_eq!(
        builder.instructions().len(),
        0,
        "execute_parallel: expected to get all instructions from builder processed"
    );
    Ok((executed_transaction_count, executed_instruction_count))
}

pub async fn execute_in_sequence(
    rpc_client: Arc<RpcClient>,
    executor: Arc<TransactionExecutor>,
    builder: &mut TransactionBuilder,
    priority_fee_policy: &PriorityFeePolicy,
) -> anyhow::Result<(usize, usize)> {
    let executed_instruction_count = builder.instructions().len();
    let execution_data =
        builder_to_execution_data(rpc_client.url(), builder, Some(priority_fee_policy.clone()));
    let executed_transaction_count = execution_data.len();
    execute_transactions_in_sequence(executor.clone(), execution_data).await?;
    // when all executed successfully then builder should be empty
    assert_eq!(
        builder.instructions().len(),
        0,
        "execute_in_sequence: expected to get all instructions from builder processed"
    );
    Ok((executed_transaction_count, executed_instruction_count))
}
