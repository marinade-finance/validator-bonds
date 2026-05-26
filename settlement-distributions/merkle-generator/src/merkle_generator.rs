use anyhow::{anyhow, bail};
use log::{debug, info};
use merkle_tree::psr_claim::TreeNode;
use merkle_tree::MerkleTree;
use settlement_common::merkle_tree_collection::{get_proof, MerkleTreeCollection, MerkleTreeMeta};
use settlement_common::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection, SettlementFunder, SettlementKey,
};
use settlement_common::utils::sort_merged_claims_deterministically;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::path::Path;
use validator_bonds::state::bond::find_bond_address;
use validator_bonds::state::settlement::find_settlement_address;

/// Configuration for merkle tree generation
pub struct GeneratorConfig {
    /// The validator bonds config pubkey used to derive bond accounts
    pub validator_bonds_config: Pubkey,
}

/// Represents a source settlement file with its parsed content
pub struct SettlementSource {
    pub name: String,
    pub collection: SettlementCollection,
}

/// Loads settlement collections from multiple input files
pub fn load_settlement_files<P: AsRef<Path>>(paths: &[P]) -> anyhow::Result<Vec<SettlementSource>> {
    let mut sources = Vec::with_capacity(paths.len());

    for path in paths {
        let path_ref = path.as_ref();
        let name = path_ref
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        info!("Loading settlement file: {}", path_ref.display());
        let collection: SettlementCollection =
            settlement_common::utils::read_from_json_file(&path_ref)
                .map_err(|e| anyhow!("Failed to load {}: {}", path_ref.display(), e))?;

        sources.push(SettlementSource { name, collection });
    }

    Ok(sources)
}

/// Validates that all settlement collections have consistent epoch and slot
fn validate_sources(sources: &[SettlementSource]) -> anyhow::Result<(u64, u64)> {
    if sources.is_empty() {
        bail!("No settlement sources provided");
    }

    let first = &sources[0].collection;
    let epoch = first.epoch;
    let slot = first.slot;

    for source in sources.iter().skip(1) {
        if source.collection.epoch != epoch {
            bail!(
                "Epoch mismatch: {} has epoch {}, expected {}",
                source.name,
                source.collection.epoch,
                epoch
            );
        }
        if source.collection.slot != slot {
            bail!(
                "Slot mismatch: {} has slot {}, expected {} — different slots mean different stake snapshots",
                source.name, source.collection.slot, slot
            );
        }
    }

    Ok((epoch, slot))
}

/// Merges claims with the same (withdraw_authority, stake_authority) key by summing claim_amount.
fn merge_claims(claims: Vec<SettlementClaim>) -> Vec<(SettlementKey, u64)> {
    let mut amount_map: HashMap<SettlementKey, u64> = HashMap::new();

    for claim in claims {
        let key = SettlementKey {
            withdraw_authority: claim.withdraw_authority,
            stake_authority: claim.stake_authority,
        };
        *amount_map.entry(key).or_default() += claim.claim_amount;
    }

    amount_map.into_iter().collect()
}

/// Generates merkle trees from multiple settlement sources.
/// Each (validator, funder) pair gets a separate merkle tree with merged claims from all sources.
pub fn generate_merkle_tree_collection(
    sources: Vec<SettlementSource>,
    config: &GeneratorConfig,
) -> anyhow::Result<MerkleTreeCollection> {
    let (epoch, slot) = validate_sources(&sources)?;
    let source_names: Vec<String> = sources.iter().map(|s| s.name.clone()).collect();

    info!(
        "Generating unified merkle trees from {} settlement sources for epoch {}: {:?}",
        sources.len(),
        epoch,
        source_names
    );

    // Group all settlements by (vote_account, funder)
    let mut grouped_settlements: HashMap<(Pubkey, SettlementFunder), Vec<&Settlement>> =
        HashMap::new();

    for source in &sources {
        for settlement in &source.collection.settlements {
            grouped_settlements
                .entry((settlement.vote_account, settlement.meta.funder.clone()))
                .or_default()
                .push(settlement);
        }
    }

    info!(
        "Found {} unique (validator, funder) groups across all sources",
        grouped_settlements.len()
    );

    // Generate merkle trees for each validator
    let mut merkle_trees: Vec<MerkleTreeMeta> = Vec::new();

    for ((vote_account, funder), settlements) in grouped_settlements {
        debug!(
            "Processing {} settlements for vote_account {}",
            settlements.len(),
            vote_account
        );

        // Derive bond account from vote account and config
        let (bond_account, _) = find_bond_address(&config.validator_bonds_config, &vote_account);

        // Collect and merge all claims from all settlements for this validator
        let all_claims: Vec<SettlementClaim> =
            settlements.iter().flat_map(|s| s.claims.clone()).collect();

        let mut merged_claims = merge_claims(all_claims);
        sort_merged_claims_deterministically(&mut merged_claims);

        // Convert claims to tree nodes
        let mut tree_nodes: Vec<TreeNode> = merged_claims
            .iter()
            .enumerate()
            .map(|(index, (key, amount))| TreeNode {
                stake_authority: key.stake_authority,
                withdraw_authority: key.withdraw_authority,
                claim: *amount,
                index: index as u64,
                proof: None,
            })
            .collect();

        let max_total_claim_sum: u64 = tree_nodes.iter().map(|node| node.claim).sum();
        let max_total_claims = tree_nodes.len();

        // Skip validators with no claims
        if max_total_claims == 0 {
            debug!("Skipping vote_account {vote_account} - no claims");
            continue;
        }

        // Generate merkle tree
        let hashed_nodes: Vec<[u8; 32]> = tree_nodes.iter().map(|n| n.hash().to_bytes()).collect();
        let merkle_tree = MerkleTree::new(&hashed_nodes[..], true);

        // Add proofs to tree nodes
        for (i, tree_node) in tree_nodes.iter_mut().enumerate() {
            tree_node.proof = Some(get_proof(&merkle_tree, i));
        }

        let merkle_root = merkle_tree.get_root().cloned();

        // Derive settlement account PDA
        let root = merkle_root.ok_or_else(|| {
            anyhow!(
                "Merkle tree with claims must have a root for bond {bond_account} epoch {epoch}"
            )
        })?;
        let settlement_account = find_settlement_address(&bond_account, &root.to_bytes(), epoch).0;

        let funding_sources = HashMap::from([(funder, max_total_claim_sum)]);

        debug!(
            "Generated merkle tree for {vote_account}: {max_total_claims} claims, {max_total_claim_sum} lamports, root: {merkle_root:?}"
        );

        merkle_trees.push(MerkleTreeMeta {
            merkle_root,
            max_total_claim_sum,
            max_total_claims,
            vote_account,
            bond_account,
            settlement_account,
            funding_sources,
            tree_nodes,
        });
    }

    // Sort merkle trees by (vote_account, funder) for deterministic output
    merkle_trees.sort_by(|a, b| {
        a.vote_account.cmp(&b.vote_account).then_with(|| {
            // Each tree has exactly one funder entry after grouping by funder
            let funder_a = a.funding_sources.keys().next();
            let funder_b = b.funding_sources.keys().next();
            funder_a.cmp(&funder_b)
        })
    });

    info!(
        "Generated {} unified merkle trees with total {} claims",
        merkle_trees.len(),
        merkle_trees
            .iter()
            .map(|t| t.max_total_claims)
            .sum::<usize>()
    );

    Ok(MerkleTreeCollection {
        epoch,
        slot,
        validator_bonds_config: config.validator_bonds_config,
        sources: source_names,
        merkle_trees,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use settlement_common::settlement_collection::{
        SettlementFunder, SettlementMeta, SettlementReason,
    };
    use solana_sdk::pubkey::Pubkey;
    use std::collections::HashMap;

    fn create_test_claim(
        withdraw: Pubkey,
        stake: Pubkey,
        amount: u64,
        stake_amount: u64,
    ) -> SettlementClaim {
        let mut stake_accounts = HashMap::new();
        stake_accounts.insert(Pubkey::new_unique(), stake_amount);
        SettlementClaim {
            withdraw_authority: withdraw,
            stake_authority: stake,
            stake_accounts,
            active_stake: stake_amount,
            activating_stake: 0,
            claim_amount: amount,
        }
    }

    fn create_test_settlement(
        vote_account: Pubkey,
        reason: SettlementReason,
        funder: SettlementFunder,
        claims: Vec<SettlementClaim>,
    ) -> Settlement {
        let claims_amount = claims.iter().map(|c| c.claim_amount).sum();
        let claims_count = claims.len();
        Settlement {
            reason,
            meta: SettlementMeta { funder },
            vote_account,
            claims_count,
            claims_amount,
            claims,
            details: None,
        }
    }

    #[test]
    fn test_merge_claims_same_authority() {
        let withdraw = Pubkey::new_unique();
        let stake = Pubkey::new_unique();

        let claims = vec![
            create_test_claim(withdraw, stake, 100, 1000),
            create_test_claim(withdraw, stake, 200, 2000),
        ];

        let merged = merge_claims(claims);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].1, 300);
    }

    #[test]
    fn test_merge_claims_overlapping_stake_accounts() {
        let withdraw = Pubkey::new_unique();
        let stake = Pubkey::new_unique();
        let shared_stake_account = Pubkey::new_unique();
        let unique_stake_account = Pubkey::new_unique();

        let claim1 = SettlementClaim {
            withdraw_authority: withdraw,
            stake_authority: stake,
            stake_accounts: HashMap::from([
                (shared_stake_account, 1000),
                (unique_stake_account, 500),
            ]),
            active_stake: 1500,
            activating_stake: 0,
            claim_amount: 100,
        };
        let claim2 = SettlementClaim {
            withdraw_authority: withdraw,
            stake_authority: stake,
            stake_accounts: HashMap::from([(shared_stake_account, 1000)]),
            active_stake: 1000,
            activating_stake: 0,
            claim_amount: 50,
        };

        let merged = merge_claims(vec![claim1, claim2]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].1, 150); // claims summed
    }

    #[test]
    fn test_merge_claims_different_authority() {
        let withdraw1 = Pubkey::new_unique();
        let withdraw2 = Pubkey::new_unique();
        let stake = Pubkey::new_unique();

        let claims = vec![
            create_test_claim(withdraw1, stake, 100, 1000),
            create_test_claim(withdraw2, stake, 200, 2000),
        ];

        let merged = merge_claims(claims);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn test_generate_merkle_tree_collection() {
        let vote_account = Pubkey::new_unique();
        let withdraw = Pubkey::new_unique();
        let stake = Pubkey::new_unique();

        let settlement1 = create_test_settlement(
            vote_account,
            SettlementReason::Bidding,
            SettlementFunder::ValidatorBond,
            vec![create_test_claim(withdraw, stake, 100, 1000)],
        );

        let settlement2 = create_test_settlement(
            vote_account,
            SettlementReason::BidTooLowPenalty,
            SettlementFunder::ValidatorBond,
            vec![create_test_claim(withdraw, stake, 50, 500)],
        );

        let source1 = SettlementSource {
            name: "bid-settlements.json".to_string(),
            collection: SettlementCollection {
                slot: 12345,
                epoch: 100,
                settlements: vec![settlement1],
            },
        };

        let source2 = SettlementSource {
            name: "psr-settlements.json".to_string(),
            collection: SettlementCollection {
                slot: 12345,
                epoch: 100,
                settlements: vec![settlement2],
            },
        };

        let config = GeneratorConfig {
            validator_bonds_config: Pubkey::new_unique(),
        };

        let result = generate_merkle_tree_collection(vec![source1, source2], &config).unwrap();

        assert_eq!(result.epoch, 100);
        assert_eq!(result.slot, 12345);
        assert_eq!(result.merkle_trees.len(), 1);
        assert_eq!(result.merkle_trees[0].max_total_claims, 1); // Claims merged
        assert_eq!(result.merkle_trees[0].max_total_claim_sum, 150); // 100 + 50
        assert_eq!(result.sources.len(), 2);
    }

    #[test]
    fn test_validate_sources_empty_returns_error() {
        let sources: Vec<SettlementSource> = vec![];
        let result = validate_sources(&sources);
        assert!(result.is_err(), "empty sources must return an error");
        let msg = format!("{}", result.unwrap_err());
        assert!(
            msg.contains("No settlement sources"),
            "error message should mention missing sources, got: {msg}"
        );
    }

    #[test]
    fn test_generate_merkle_tree_same_authority_different_sources_sums() {
        // Same (withdraw_authority, stake_authority) appears in two different sources for the
        // same (vote_account, funder).  The resulting tree must contain exactly one node whose
        // claim equals the sum of both source claims.
        let vote_account = Pubkey::new_unique();
        let withdraw = Pubkey::new_unique();
        let stake = Pubkey::new_unique();

        let settlement_a = create_test_settlement(
            vote_account,
            SettlementReason::Bidding,
            SettlementFunder::ValidatorBond,
            vec![create_test_claim(withdraw, stake, 300, 3000)],
        );
        let settlement_b = create_test_settlement(
            vote_account,
            SettlementReason::BidTooLowPenalty,
            SettlementFunder::ValidatorBond,
            vec![create_test_claim(withdraw, stake, 700, 7000)],
        );

        let source_a = SettlementSource {
            name: "source-a.json".to_string(),
            collection: SettlementCollection {
                slot: 5000,
                epoch: 42,
                settlements: vec![settlement_a],
            },
        };
        let source_b = SettlementSource {
            name: "source-b.json".to_string(),
            collection: SettlementCollection {
                slot: 5000,
                epoch: 42,
                settlements: vec![settlement_b],
            },
        };

        let config = GeneratorConfig {
            validator_bonds_config: Pubkey::new_unique(),
        };

        let result = generate_merkle_tree_collection(vec![source_a, source_b], &config).unwrap();

        assert_eq!(
            result.merkle_trees.len(),
            1,
            "one (vote_account, funder) group"
        );
        let tree = &result.merkle_trees[0];

        // Both sources had the same (withdraw, stake) key → merged into one node
        assert_eq!(
            tree.max_total_claims, 1,
            "claims must be merged into one node"
        );
        assert_eq!(
            tree.max_total_claim_sum, 1000,
            "merged claim must equal 300+700"
        );
        assert_eq!(
            tree.tree_nodes[0].claim, 1000,
            "tree node claim must be the summed amount"
        );
    }

    #[test]
    fn test_separate_trees_for_different_funders() {
        let vote_account = Pubkey::new_unique();
        let withdraw = Pubkey::new_unique();
        let stake = Pubkey::new_unique();

        // Same vote_account but different funders → should produce 2 separate trees
        let settlement_bond = create_test_settlement(
            vote_account,
            SettlementReason::Bidding,
            SettlementFunder::ValidatorBond,
            vec![create_test_claim(withdraw, stake, 100, 1000)],
        );

        let settlement_marinade = create_test_settlement(
            vote_account,
            SettlementReason::Bidding,
            SettlementFunder::Marinade,
            vec![create_test_claim(withdraw, stake, 200, 2000)],
        );

        let source = SettlementSource {
            name: "mixed-settlements.json".to_string(),
            collection: SettlementCollection {
                slot: 12345,
                epoch: 100,
                settlements: vec![settlement_bond, settlement_marinade],
            },
        };

        let config = GeneratorConfig {
            validator_bonds_config: Pubkey::new_unique(),
        };

        let result = generate_merkle_tree_collection(vec![source], &config).unwrap();

        assert_eq!(result.merkle_trees.len(), 2);

        // Both trees are for the same vote_account
        assert_eq!(result.merkle_trees[0].vote_account, vote_account);
        assert_eq!(result.merkle_trees[1].vote_account, vote_account);

        // Each tree has exactly one funder entry
        assert_eq!(result.merkle_trees[0].funding_sources.len(), 1);
        assert_eq!(result.merkle_trees[1].funding_sources.len(), 1);

        // Sorted by funder: ValidatorBond (variant 0) < Marinade (variant 1)
        assert!(result.merkle_trees[0]
            .funding_sources
            .contains_key(&SettlementFunder::ValidatorBond));
        assert!(result.merkle_trees[1]
            .funding_sources
            .contains_key(&SettlementFunder::Marinade));

        // Verify amounts per tree
        assert_eq!(result.merkle_trees[0].max_total_claim_sum, 100); // ValidatorBond
        assert_eq!(result.merkle_trees[1].max_total_claim_sum, 200); // Marinade

        // Different merkle roots (different claim amounts → different trees)
        assert_ne!(
            result.merkle_trees[0].merkle_root,
            result.merkle_trees[1].merkle_root
        );
    }
}
