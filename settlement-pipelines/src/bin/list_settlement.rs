use clap::Parser;
use log::{debug, error, info, warn};
use settlement_engine::merkle_tree_collection::MerkleTreeCollection;
use settlement_engine::utils::{read_from_json_file, write_to_json_file};
use settlement_pipelines::arguments::GlobalOpts;
use settlement_pipelines::init::init_log;
use settlement_pipelines::json_data::BondSettlement;
use std::path::PathBuf;
use validator_bonds::state::bond::find_bond_address;
use validator_bonds::state::settlement::find_settlement_address;

// Printing on std out the list settlements from JSON files in a directory
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    /// Paths to json files with tree collection
    #[arg(short = 'm', value_delimiter = ' ', num_args(1..))]
    merkle_tree_files: Vec<PathBuf>,

    /// File where the list of settlements will be written to in JSON format
    #[arg(long)]
    out: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let config_address = args.global_opts.config;
    info!(
        "Listing settlements from JSON files {:?} for validator-bonds config: {}",
        args.merkle_tree_files, config_address
    );

    let merkle_tree_collection = load_merkle_tree_files(&args.merkle_tree_files)?;

    let bond_settlements: Vec<BondSettlement> = merkle_tree_collection
        .iter()
        .flat_map(|mtc| mtc.merkle_trees.iter().map(move |tree| (tree, mtc.epoch)))
        .filter(|(merkle_tree, epoch)| {
            if merkle_tree.merkle_root.is_none() {
                error!(
                    "Merkle tree [epoch {}, vote account{}] does not have a root, skipping",
                    epoch, merkle_tree.vote_account
                );
                return false;
            }
            merkle_tree.merkle_root.is_some()
        })
        .map(|(merkle_tree, epoch)| {
            let merkle_root = merkle_tree
                .merkle_root
                .expect("Merkle root cannot be None as filtered above")
                .to_bytes();
            let (bond_address, _) = find_bond_address(&config_address, &merkle_tree.vote_account);
            let (settlement_address, _) =
                find_settlement_address(&bond_address, &merkle_root, epoch);
            BondSettlement {
                bond_address,
                vote_account_address: merkle_tree.vote_account,
                settlement_address,
                epoch,
                merkle_root,
            }
        })
        .collect();

    info!(
        "Settlements: {:?}",
        bond_settlements
            .iter()
            .map(|s| s.settlement_address.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    write_to_json_file(&bond_settlements, args.out.as_str())?;
    Ok(())
}

fn load_merkle_tree_files(
    merkle_tree_files: &[PathBuf],
) -> anyhow::Result<Vec<MerkleTreeCollection>> {
    let mut merkle_trees: Vec<MerkleTreeCollection> = vec![];
    for path in merkle_tree_files.iter().filter(|path| {
        if path.is_file() {
            debug!("Processing file: {:?}", path);
            true
        } else {
            debug!("Skipping path: {:?} as not a file", path);
            false
        }
    }) {
        read_from_json_file(path).map_or_else(
            |e| {
                warn!(
                    "Cannot load file '{:?}' as MerkleTreeCollection: {:?}",
                    path, e
                )
            },
            |s| merkle_trees.push(s),
        );
    }

    Ok(merkle_trees)
}
