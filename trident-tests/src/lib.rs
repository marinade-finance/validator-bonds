//! Trident fuzz harness for the validator-bonds program.
//!
//! - `ix`: instruction builders (account order from the IDL)
//! - `state`: account decoders and test-account builders (stake, vote, Marinade fixtures)
//! - `merkle`: merkle tree matching the on-chain proof verification
//! - `world`: shared fuzz state, transaction execution, invariants checked after every transaction
//! - `acts`: fuzz actions with per-instruction oracles

pub mod acts;
pub mod ix;
pub mod merkle;
pub mod state;
pub mod world;
