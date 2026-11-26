use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;
use solana_transaction_builder::Group;
use solana_transaction_builder_executor::{run, GroupStatus, RunConfig, RunReport};
use solana_transaction_executor::TransactionExecutor;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub struct RunSummary {
    pub report: RunReport,
    pub tx_count: usize,
    pub ix_count: usize,
}

impl RunSummary {
    /// One line per group that did not land: id, status and error text.
    pub fn errors(&self) -> Vec<String> {
        self.report
            .groups
            .iter()
            .filter_map(|outcome| {
                let status = match &outcome.status {
                    GroupStatus::Landed { .. } | GroupStatus::Planned => return None,
                    GroupStatus::Failed {
                        error,
                        logs,
                        signature: Some(signature),
                    } => format!("failed in {signature}: {error}{}", with_logs(logs)),
                    GroupStatus::Failed { error, logs, .. } => {
                        format!("failed: {error}{}", with_logs(logs))
                    }
                    GroupStatus::NotSent { reason } => format!("not sent: {reason}"),
                    GroupStatus::NotLanded { attempts } => {
                        format!("not landed after {attempts} attempts")
                    }
                    GroupStatus::Unknown { reason, signatures } => {
                        format!("unknown: {reason}, signatures {signatures:?}")
                    }
                };
                Some(format!("{}: {status}", outcome.id))
            })
            .collect()
    }
}

fn with_logs(logs: &[String]) -> String {
    if logs.is_empty() {
        String::new()
    } else {
        format!(", logs: {logs:?}")
    }
}

pub async fn execute(
    executor: &TransactionExecutor,
    payer: &Pubkey,
    groups: Vec<Group>,
    signers: &[Arc<dyn Signer + Send + Sync>],
    config: &RunConfig,
) -> RunSummary {
    let instructions = instruction_counts(&groups);
    let report = run(executor, payer, groups, signers, config).await;
    summarize(report, &instructions)
}

/// One `run()` per group, in order; a failed group does not stop the next one.
pub async fn execute_in_sequence(
    executor: &TransactionExecutor,
    payer: &Pubkey,
    groups: Vec<Group>,
    signers: &[Arc<dyn Signer + Send + Sync>],
    config: &RunConfig,
) -> RunSummary {
    let instructions = instruction_counts(&groups);
    let mut report = RunReport::default();
    for group in groups {
        let single = run(executor, payer, vec![group], signers, config).await;
        report.groups.extend(single.groups);
        report.transactions.extend(single.transactions);
    }
    summarize(report, &instructions)
}

fn instruction_counts(groups: &[Group]) -> HashMap<String, usize> {
    groups
        .iter()
        .map(|group| (group.id().to_owned(), group.instructions().len()))
        .collect()
}

fn summarize(report: RunReport, instructions: &HashMap<String, usize>) -> RunSummary {
    let mut signatures = HashSet::new();
    let mut ix_count = 0;
    for outcome in &report.groups {
        if let GroupStatus::Landed { signature, .. } = &outcome.status {
            signatures.insert(*signature);
            ix_count += instructions.get(&outcome.id).copied().unwrap_or(0);
        }
    }
    RunSummary {
        report,
        tx_count: signatures.len(),
        ix_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::Signature;
    use solana_transaction_builder_executor::GroupOutcome;

    fn outcome(id: &str, status: GroupStatus) -> GroupOutcome {
        GroupOutcome {
            id: id.to_string(),
            status,
        }
    }

    #[test]
    fn landed_groups_of_one_transaction_count_once_and_the_rest_are_errors() {
        let signature = Signature::from([1; 64]);
        let landed = GroupStatus::Landed { signature, slot: 5 };
        let report = RunReport {
            groups: vec![
                outcome("a", landed.clone()),
                outcome("b", landed),
                outcome(
                    "c",
                    GroupStatus::Failed {
                        error: "custom program error: 0x1".to_string(),
                        logs: vec![],
                        signature: None,
                    },
                ),
                outcome(
                    "d",
                    GroupStatus::Unknown {
                        reason: "watcher stopped".to_string(),
                        signatures: vec![],
                    },
                ),
                outcome("e", GroupStatus::Planned),
                outcome(
                    "f",
                    GroupStatus::Failed {
                        error: "custom program error: 0x10".to_string(),
                        logs: vec!["Program log: stake".to_string()],
                        signature: Some(signature),
                    },
                ),
            ],
            transactions: vec![],
        };
        let instructions = HashMap::from([
            ("a".to_string(), 2),
            ("b".to_string(), 3),
            ("c".to_string(), 4),
            ("d".to_string(), 5),
            ("e".to_string(), 6),
            ("f".to_string(), 7),
        ]);

        let summary = summarize(report, &instructions);

        assert_eq!(summary.tx_count, 1);
        assert_eq!(summary.ix_count, 5);
        assert_eq!(
            summary.errors(),
            vec![
                "c: failed: custom program error: 0x1".to_string(),
                "d: unknown: watcher stopped, signatures []".to_string(),
                format!(
                    "f: failed in {signature}: custom program error: 0x10, logs: [\"Program log: stake\"]"
                ),
            ]
        );
    }
}
