use log::debug;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_builder_executor::{
    builder_to_execution_data, execute_transaction_data_in_parallel,
    execute_transaction_data_in_sequence, TransactionBuilderExecutionData,
    TransactionBuilderExecutionErrors,
};
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::sync::Arc;

const PARALLEL_EXECUTION_RATE_DEFAULT: usize = 30;

pub async fn execute_parallel(
    rpc_client: Arc<RpcClient>,
    executor: Arc<TransactionExecutor>,
    builder: &mut TransactionBuilder,
    priority_fee_policy: &PriorityFeePolicy,
) -> Result<(usize, usize), TransactionBuilderExecutionErrors> {
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
) -> Result<(usize, usize), TransactionBuilderExecutionErrors> {
    let execution_data = builder_to_execution_data(
        rpc_client.url(),
        builder,
        Some(priority_fee_policy.clone()),
        false,
    );
    // when all executed successfully then builder should be empty
    assert_eq!(
        builder.instructions().len(),
        0,
        "execute_parallel: expected to get all instructions from builder processed"
    );
    let execution_results = execute_transaction_data_in_parallel(
        executor.clone(),
        &execution_data,
        Some(parallel_execution_rate),
    )
    .await;
    handle_execution_results(&execution_data, execution_results)
}

pub async fn execute_in_sequence(
    rpc_client: Arc<RpcClient>,
    executor: Arc<TransactionExecutor>,
    builder: &mut TransactionBuilder,
    priority_fee_policy: &PriorityFeePolicy,
    execute_one_by_one: bool,
) -> Result<(usize, usize), TransactionBuilderExecutionErrors> {
    let execution_data = builder_to_execution_data(
        rpc_client.url(),
        builder,
        Some(priority_fee_policy.clone()),
        execute_one_by_one,
    );
    // when all executed successfully then builder should be empty
    assert_eq!(
        builder.instructions().len(),
        0,
        "execute_in_sequence: expected to get all instructions from builder processed"
    );
    let execution_results =
        execute_transaction_data_in_sequence(executor.clone(), &execution_data, false).await;
    handle_execution_results(&execution_data, execution_results)
}

/// Method takes list of data that were about to be executed
/// and the list of errors that came from that execution.
/// It matches the execution data to the list of errors and returns the count of executed transactions and instructions.
fn handle_execution_results(
    transaction_builder_execution_data: &[TransactionBuilderExecutionData],
    executed_result: Result<(), TransactionBuilderExecutionErrors>,
) -> Result<(usize, usize), TransactionBuilderExecutionErrors> {
    let to_execute_transaction_count = transaction_builder_execution_data.len();
    let to_execute_instruction_count: usize = transaction_builder_execution_data
        .iter()
        .map(|data| {
            data.prepared_transaction
                .transaction
                .message
                .instructions
                .len()
        })
        .sum();
    match executed_result {
        Ok(_) => Ok((to_execute_transaction_count, to_execute_instruction_count)),
        Err(errors) => {
            let failed_transaction_count = errors.len();
            let failed_instruction_count: usize = errors
                .iter()
                .map(|error| {
                    let failed_tx_uuid = error.tx_uuid.as_str();
                    transaction_builder_execution_data
                        .iter()
                        .find(|data| data.tx_uuid.as_str() == failed_tx_uuid)
                        .map_or_else(
                            || 0,
                            |data| {
                                data.prepared_transaction
                                    .transaction
                                    .message
                                    .instructions
                                    .len()
                            },
                        )
                })
                .sum();
            assert!(
                to_execute_instruction_count >= failed_instruction_count,
                "map_executed_data_to_execution_errors: failed_instruction_count should be less or equal to to_execute_instruction_count"
            );
            assert!(
                to_execute_transaction_count >= failed_transaction_count,
                "map_executed_data_to_execution_errors: failed_transaction_count should be less or equal to to_execute_transaction_count"
            );
            debug!(
                "Execution errors: executed {}/{} transactions and {}/{} instructions",
                to_execute_transaction_count - failed_transaction_count,
                to_execute_transaction_count,
                to_execute_instruction_count - failed_instruction_count,
                to_execute_instruction_count
            );
            Err(errors)
        }
    }
}
