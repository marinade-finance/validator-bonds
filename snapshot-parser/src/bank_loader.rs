use {
    log::info,
    solana_accounts_db::hardened_unpack::{open_genesis_config, MAX_GENESIS_ARCHIVE_UNPACKED_SIZE},
    solana_ledger::{bank_forks_utils, blockstore_processor::ProcessOptions},
    solana_ledger::{
        blockstore::Blockstore,
        blockstore_options::{AccessType, BlockstoreOptions, LedgerColumnOptions},
    },
    solana_runtime::{
        bank::Bank,
        snapshot_config::{SnapshotConfig, SnapshotUsage},
    },
    solana_sdk::clock::Slot,
    std::{
        path::{Path, PathBuf},
        sync::{atomic::AtomicBool, Arc},
    },
};

pub fn create_bank_from_ledger(ledger_path: &Path) -> anyhow::Result<Arc<Bank>> {
    let genesis_config = open_genesis_config(ledger_path, MAX_GENESIS_ARCHIVE_UNPACKED_SIZE);
    let snapshot_config = SnapshotConfig {
        usage: SnapshotUsage::LoadOnly,
        full_snapshot_archive_interval_slots: Slot::MAX,
        incremental_snapshot_archive_interval_slots: Slot::MAX,
        full_snapshot_archives_dir: PathBuf::from(ledger_path),
        incremental_snapshot_archives_dir: PathBuf::from(ledger_path),
        bank_snapshots_dir: PathBuf::from(ledger_path),
        ..SnapshotConfig::default()
    };
    let blockstore = Blockstore::open_with_options(
        ledger_path,
        BlockstoreOptions {
            access_type: AccessType::PrimaryForMaintenance,
            recovery_mode: None,
            enforce_ulimit_nofile: false,
            column_options: LedgerColumnOptions::default(),
        },
    )?;
    info!("Blockstore loaded.");

    let (bank_forks, _, _) = bank_forks_utils::load_bank_forks(
        &genesis_config,
        &blockstore,
        vec![PathBuf::from(ledger_path).join(Path::new("stake-meta.accounts"))],
        None,
        Some(&snapshot_config),
        &ProcessOptions::default(),
        None,
        None,
        None,
        Arc::new(AtomicBool::new(false)),
    );
    info!("Bank forks loaded.");

    let working_bank = bank_forks.read().unwrap().working_bank();
    info!("Bank slot: {}", working_bank.slot());

    Ok(working_bank)
}
