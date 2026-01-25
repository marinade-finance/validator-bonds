use anyhow::{anyhow, bail};
use log::{debug, info, warn};
use merkle_tree::psr_claim::TreeNode;
use merkle_tree::MerkleTree;
use settlement_common::merkle_tree_collection::{get_proof, MerkleTreeCollection, MerkleTreeMeta};
use settlement_common::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection, SettlementFunder,
};
use settlement_common::utils::sort_claims_deterministically;
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

/// Key for grouping claims within a settlement
#[derive(Hash, Eq, PartialEq, Clone)]
struct ClaimKey {
    withdraw_authority: Pubkey,
    stake_authority: Pubkey,
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
            warn!(
                "Slot mismatch: {} has slot {}, expected {} (using {})",
                source.name, source.collection.slot, slot, slot
            );
        }
    }

    Ok((epoch, slot))
}

/// Merges claims with the same (withdraw_authority, stake_authority) key
fn merge_claims(claims: Vec<SettlementClaim>) -> Vec<SettlementClaim> {
    let mut claim_map: HashMap<ClaimKey, SettlementClaim> = HashMap::new();

    for claim in claims {
        let key = ClaimKey {
            withdraw_authority: claim.withdraw_authority,
            stake_authority: claim.stake_authority,
        };

        claim_map
            .entry(key)
            .and_modify(|existing| {
                // Sum claim amounts
                existing.claim_amount += claim.claim_amount;
                // Sum active stakes
                existing.active_stake += claim.active_stake;
                // Union stake accounts (merge HashMaps, summing values for same keys)
                for (pubkey, lamports) in claim.stake_accounts.iter() {
                    existing
                        .stake_accounts
                        .entry(*pubkey)
                        .and_modify(|v| *v += lamports)
                        .or_insert(*lamports);
                }
            })
            .or_insert(claim);
    }

    claim_map.into_values().collect()
}

/// Generates merkle trees from multiple settlement sources.
/// Each validator gets a single merkle tree with merged claims from all sources.
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

    // Group all settlements by vote_account (validator)
    let mut validator_settlements: HashMap<Pubkey, Vec<&Settlement>> = HashMap::new();
    // Track per-funder amounts per validator
    let mut validator_funding: HashMap<Pubkey, HashMap<SettlementFunder, u64>> = HashMap::new();

    for source in &sources {
        for settlement in &source.collection.settlements {
            validator_settlements
                .entry(settlement.vote_account)
                .or_default()
                .push(settlement);
            // Accumulate funding amounts per funder per validator
            *validator_funding
                .entry(settlement.vote_account)
                .or_default()
                .entry(settlement.meta.funder.clone())
                .or_insert(0) += settlement.claims_amount;
        }
    }

    info!(
        "Found {} unique validators across all sources",
        validator_settlements.len()
    );

    // Generate merkle trees for each validator
    let mut merkle_trees: Vec<MerkleTreeMeta> = Vec::new();

    for (vote_account, settlements) in validator_settlements {
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
        sort_claims_deterministically(&mut merged_claims);

        // Convert claims to tree nodes
        let mut tree_nodes: Vec<TreeNode> = merged_claims
            .iter()
            .enumerate()
            .map(|(index, claim)| TreeNode {
                stake_authority: claim.stake_authority,
                withdraw_authority: claim.withdraw_authority,
                claim: claim.claim_amount,
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

        let funding_sources = validator_funding.remove(&vote_account).unwrap_or_default();

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

    // Sort merkle trees by vote_account for deterministic output
    merkle_trees.sort_by_key(|t| t.vote_account);

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
        active_stake: u64,
    ) -> SettlementClaim {
        let mut stake_accounts = HashMap::new();
        stake_accounts.insert(Pubkey::new_unique(), active_stake);
        SettlementClaim {
            withdraw_authority: withdraw,
            stake_authority: stake,
            stake_accounts,
            active_stake,
            claim_amount: amount,
        }
    }

    fn create_test_settlement(
        vote_account: Pubkey,
        reason: SettlementReason,
        claims: Vec<SettlementClaim>,
    ) -> Settlement {
        let claims_amount = claims.iter().map(|c| c.claim_amount).sum();
        let claims_count = claims.len();
        Settlement {
            reason,
            meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
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
        assert_eq!(merged[0].claim_amount, 300);
        assert_eq!(merged[0].active_stake, 3000);
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
            vec![create_test_claim(withdraw, stake, 100, 1000)],
        );

        let settlement2 = create_test_settlement(
            vote_account,
            SettlementReason::BidTooLowPenalty,
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
}
