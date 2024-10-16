use validator_bonds::entry as entry_validator_bonds;
use validator_bonds::ID as PROGRAM_ID_VALIDATOR_BONDS;
const PROGRAM_NAME_VALIDATOR_BONDS: &str = "validator_bonds";
use fuzz_instructions::validator_bonds_fuzz_instructions::FuzzInstruction as FuzzInstruction_validator_bonds;
use trident_client::fuzzing::*;
mod accounts_snapshots;
mod common;
mod fuzz_instructions;

pub type FuzzInstruction = FuzzInstruction_validator_bonds;

struct MyFuzzData;

impl FuzzDataBuilder<FuzzInstruction> for MyFuzzData {}

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

            // This is probably not needed as part of the test validator
            // let stake_program = FuzzingProgram::new(
            //     "stake-program",
            //     &anchor_lang::solana_program::stake::program::ID,
            //     None,
            // );
            // let vote_program = FuzzingProgram::new(
            //     "vote-program",
            //     &anchor_lang::solana_program::vote::program::ID,
            //     None,
            // );
            // let associated_token_program = FuzzingProgram::new(
            //     "associated-token-program",
            //     &anchor_spl::associated_token::ID,
            //     None,
            // );
            // let token_program = FuzzingProgram::new(
            //     "token-program",
            //     &anchor_spl::token::ID,
            //     None,
            // );

            let mut client =
                ProgramTestClientBlocking::new(&[
                    validator_bonds_program,
                    metaplex_program,
                    // stake_program,
                    // vote_program,
                    // associated_token_program,
                    // token_program,
                ])
                .unwrap();

            // fill Program ID of program you are going to call
            let _ = fuzz_data.run_with_runtime(PROGRAM_ID_VALIDATOR_BONDS, &mut client);
        });
    }
}
