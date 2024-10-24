use crate::fuzz_instructions::validator_bonds_fuzz_instructions::*;
use fuzz_instructions::validator_bonds_fuzz_instructions::FuzzInstruction as FuzzInstruction_validator_bonds;
use trident_client::fuzzing::*;
use validator_bonds::entry as entry_validator_bonds;
use validator_bonds::ID as PROGRAM_ID_VALIDATOR_BONDS;

mod accounts_snapshots;
mod common;
mod fuzz_instructions;

const PROGRAM_NAME_VALIDATOR_BONDS: &str = "validator_bonds";

pub type FuzzInstruction = FuzzInstruction_validator_bonds;

struct MyFuzzData;

impl FuzzDataBuilder<FuzzInstruction> for MyFuzzData {
    fn pre_ixs(_u: &mut arbitrary::Unstructured) -> arbitrary::Result<Vec<FuzzInstruction>> {
        Ok(vec![])
    }
    fn ixs(u: &mut arbitrary::Unstructured) -> arbitrary::Result<Vec<FuzzInstruction>> {
        Ok(vec![
            FuzzInstruction::InitConfig(InitConfig::arbitrary(u)?),
            FuzzInstruction::ConfigureConfig(ConfigureConfig::arbitrary(u)?),
            FuzzInstruction::InitBond(InitBond::arbitrary(u)?),
            FuzzInstruction::ConfigureBond(ConfigureBond::arbitrary(u)?),
            FuzzInstruction::ConfigureBondWithMint(ConfigureBondWithMint::arbitrary(u)?),
            FuzzInstruction::MintBond(MintBond::arbitrary(u)?),
            FuzzInstruction::FundBond(FundBond::arbitrary(u)?),
            FuzzInstruction::InitSettlement(InitSettlement::arbitrary(u)?),
            FuzzInstruction::CancelSettlement(CancelSettlement::arbitrary(u)?),
            FuzzInstruction::InitWithdrawRequest(InitWithdrawRequest::arbitrary(u)?),
            FuzzInstruction::FundSettlement(FundSettlement::arbitrary(u)?),
            FuzzInstruction::InitSettlement(InitSettlement::arbitrary(u)?),
            FuzzInstruction::UpsizeSettlementClaims(UpsizeSettlementClaims::arbitrary(u)?),
            FuzzInstruction::EmergencyPause(EmergencyPause::arbitrary(u)?),
            FuzzInstruction::EmergencyResume(EmergencyResume::arbitrary(u)?),
            // TODO: Trident strange behaviour
            // FuzzInstruction::MergeStake(MergeStake::arbitrary(u)?),
            // // TODO: required Trident's functionality of warping time, see https://github.com/Ackee-Blockchain/trident/issues/75
            // // FuzzInstruction::ClaimWithdrawRequest(ClaimWithdrawRequest::arbitrary(u)?),
            // // FuzzInstruction::WithdrawStake(WithdrawStake::arbitrary(u)?),
            // // FuzzInstruction::CloseSettlementV2(CloseSettlementV2::arbitrary(u)?),
            // // FuzzInstruction::ClaimSettlementV2(ClaimSettlementV2::arbitrary(u)?),
            // // FuzzInstruction::ResetStake(ResetStake::arbitrary(u)?),
        ])
    }
    fn post_ixs(_u: &mut arbitrary::Unstructured) -> arbitrary::Result<Vec<FuzzInstruction>> {
        Ok(vec![])
    }
}

fn main() {
    loop {
        fuzz_trident!(fuzz_ix: FuzzInstruction, |fuzz_data: MyFuzzData| {

            let validator_bonds_program = FuzzingProgram::new(
                PROGRAM_NAME_VALIDATOR_BONDS,
                &PROGRAM_ID_VALIDATOR_BONDS,
                processor!(
                    convert_entry!(entry_validator_bonds)
                )
            );

            let metaplex_program = FuzzingProgram::new(
                "metaplex-token-metadata-program",
                &anchor_spl::metadata::ID,
                None,
            );

            let mut client =
                ProgramTestClientBlocking::new(&[
                    validator_bonds_program,
                    metaplex_program,
                ])
                .unwrap();

            let _ = fuzz_data.run_with_runtime(PROGRAM_ID_VALIDATOR_BONDS, &mut client);
        });
    }
}
