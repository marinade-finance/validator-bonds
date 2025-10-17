pub mod claim_settlement_v1;
pub mod tree_node_v1;

pub use claim_settlement_v1::*;

/*
 * Data structures that were used in first version of the Validator Bonds program
 * (version v1) when deduplication accounts were managed by creating PDA accounts.
 * The instructions for v1 were removed while the data struct is left in code
 * to get generated in the program IDL and usable for loading on-chain logs for the v1 program.
 */
