pub mod validator_bonds_fuzz_instructions {
    use crate::accounts_snapshots::*;
    use crate::common::*;
    use anchor_lang::prelude::Clock;
    use anchor_lang::solana_program::vote::state::VoteState;
    use anchor_lang::AccountDeserialize;
    use anchor_spl::associated_token::get_associated_token_address;
    use anchor_spl::metadata::mpl_token_metadata::accounts::Metadata;
    use anchor_spl::token::TokenAccount;
    use bid_psr_distribution::merkle_tree_collection::{generate_merkle_tree_meta, MerkleTreeMeta};
    use bid_psr_distribution::settlement_collection::{
        Settlement, SettlementClaim, SettlementFunder, SettlementMeta, SettlementReason,
    };
    use log::info;
    use trident_client::fuzzing::solana_sdk::native_token::LAMPORTS_PER_SOL;
    use trident_client::fuzzing::*;
    use validator_bonds::instructions::{
        ClaimSettlementV2Args, InitSettlementArgs, MergeStakeArgs,
    };
    use validator_bonds::state::bond::{find_bond_address, find_bond_mint};
    use validator_bonds::state::config::find_bonds_withdrawer_authority;
    use validator_bonds::state::settlement::{
        find_settlement_address, find_settlement_claims_address,
    };
    use validator_bonds::state::withdraw_request::find_withdraw_request_address;
    use validator_bonds_common::constants::find_event_authority;

    #[derive(Arbitrary, DisplayIx, FuzzTestExecutor, FuzzDeserialize)]
    pub enum FuzzInstruction {
        InitConfig(InitConfig),
        ConfigureConfig(ConfigureConfig),
        InitBond(InitBond),
        ConfigureBond(ConfigureBond),
        ConfigureBondWithMint(ConfigureBondWithMint),
        MintBond(MintBond),
        FundBond(FundBond),
        InitWithdrawRequest(InitWithdrawRequest),
        CancelWithdrawRequest(CancelWithdrawRequest),
        ClaimWithdrawRequest(ClaimWithdrawRequest),
        InitSettlement(InitSettlement),
        UpsizeSettlementClaims(UpsizeSettlementClaims),
        CancelSettlement(CancelSettlement),
        FundSettlement(FundSettlement),
        MergeStake(MergeStake),
        ResetStake(ResetStake),
        WithdrawStake(WithdrawStake),
        EmergencyPause(EmergencyPause),
        EmergencyResume(EmergencyResume),
        CloseSettlementV2(CloseSettlementV2),
        ClaimSettlementV2(ClaimSettlementV2),
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitConfig {
        pub accounts: InitConfigAccounts,
        pub data: InitConfigData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitConfigAccounts {
        pub config: AccountId,
        pub rent_payer: AccountId,
        pub system_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitConfigData {
        pub admin_authority: AccountId,
        pub operator_authority: AccountId,
        pub epochs_to_claim_settlement: u64,
        pub withdraw_lockup_epochs: u64,
        pub slots_to_start_settlement_claiming: u64,
    }

    #[derive(Arbitrary, Debug)]
    pub struct ConfigureConfig {
        pub accounts: ConfigureConfigAccounts,
        pub data: ConfigureConfigData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureConfigAccounts {
        pub config: AccountId,
        pub admin_authority: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureConfigData {
        pub admin: Option<AccountId>,
        pub operator: Option<AccountId>,
        pub pause_authority: Option<AccountId>,
        pub epochs_to_claim_settlement: Option<u64>,
        pub withdraw_lockup_epochs: Option<u64>,
        pub minimum_stake_lamports: Option<u64>,
        pub slots_to_start_settlement_claiming: Option<u64>,
        pub min_bond_max_stake_wanted: Option<u64>,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitBond {
        pub accounts: InitBondAccounts,
        pub data: InitBondData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitBondAccounts {
        pub config: AccountId,
        pub vote_account: AccountId,
        pub validator_identity: AccountId,
        pub bond: AccountId,
        pub rent_payer: AccountId,
        pub system_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitBondData {
        pub bond_authority: AccountId,
        pub cpmpe: u64,
        pub max_stake_wanted: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureBond {
        pub accounts: ConfigureBondAccounts,
        pub data: ConfigureBondData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureBondAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub authority: AccountId,
        pub vote_account: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureBondData {
        pub bond_authority: Option<AccountId>,
        pub cpmpe: Option<u64>,
        pub max_stake_wanted: Option<u64>,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureBondWithMint {
        pub accounts: ConfigureBondWithMintAccounts,
        pub data: ConfigureBondWithMintData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureBondWithMintAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub mint: AccountId,
        pub vote_account: AccountId,
        pub token_account: AccountId,
        pub token_authority: AccountId,
        pub token_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ConfigureBondWithMintData {
        pub validator_identity: AccountId,
        pub bond_authority: Option<AccountId>,
        pub cpmpe: Option<u64>,
        pub max_stake_wanted: Option<u64>,
    }
    #[derive(Arbitrary, Debug)]
    pub struct MintBond {
        pub accounts: MintBondAccounts,
        pub data: MintBondData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct MintBondAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub mint: AccountId,
        pub validator_identity: AccountId,
        pub validator_identity_token_account: AccountId,
        pub vote_account: AccountId,
        pub metadata: AccountId,
        pub rent_payer: AccountId,
        pub system_program: AccountId,
        pub token_program: AccountId,
        pub associated_token_program: AccountId,
        pub metadata_program: AccountId,
        pub rent: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct MintBondData {}
    #[derive(Arbitrary, Debug)]
    pub struct FundBond {
        pub accounts: FundBondAccounts,
        pub data: FundBondData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct FundBondAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub stake_account: AccountId,
        pub stake_authority: AccountId,
        pub clock: AccountId,
        pub stake_history: AccountId,
        pub stake_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct FundBondData {}
    #[derive(Arbitrary, Debug)]
    pub struct InitWithdrawRequest {
        pub accounts: InitWithdrawRequestAccounts,
        pub data: InitWithdrawRequestData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitWithdrawRequestAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub vote_account: AccountId,
        pub authority: AccountId,
        pub withdraw_request: AccountId,
        pub rent_payer: AccountId,
        pub system_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitWithdrawRequestData {
        pub amount: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CancelWithdrawRequest {
        pub accounts: CancelWithdrawRequestAccounts,
        pub data: CancelWithdrawRequestData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CancelWithdrawRequestAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub vote_account: AccountId,
        pub authority: AccountId,
        pub withdraw_request: AccountId,
        pub rent_collector: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CancelWithdrawRequestData {}
    #[derive(Arbitrary, Debug)]
    pub struct ClaimWithdrawRequest {
        pub accounts: ClaimWithdrawRequestAccounts,
        pub data: ClaimWithdrawRequestData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ClaimWithdrawRequestAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub vote_account: AccountId,
        pub authority: AccountId,
        pub withdraw_request: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub stake_account: AccountId,
        pub withdrawer: AccountId,
        pub split_stake_account: AccountId,
        pub split_stake_rent_payer: AccountId,
        pub stake_program: AccountId,
        pub system_program: AccountId,
        pub stake_history: AccountId,
        pub clock: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ClaimWithdrawRequestData {
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| -> arbitrary::Result<u64> {
            let withdraw_request_amount = u.int_in_range(0..=u64::MAX)?;
            let withdraw_request_withdrawn = u.int_in_range(0..=withdraw_request_amount)?;
            Ok(withdraw_request_withdrawn)
        })]
        withdraw_request_withdrawn: u64,
        withdraw_request_amount: u64,
        stake_account_amount: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitSettlement {
        pub accounts: InitSettlementAccounts,
        pub data: InitSettlementData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitSettlementAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub settlement: AccountId,
        pub settlement_claims: AccountId,
        pub operator_authority: AccountId,
        pub rent_payer: AccountId,
        pub system_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct InitSettlementData {
        pub merkle_root: [u8; 32],
        pub rent_collector: AccountId,
        pub epoch: u64,
        pub settlement_vote_account: AccountId,
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| -> arbitrary::Result<Vec<SettlementClaimData>> {
            let min_length = 1;
            let length = u.int_in_range(min_length..=usize::MAX)?;
            let mut vec = Vec::with_capacity(length);
            for _ in 0..length {
                vec.push(u.arbitrary()?);
            }
            Ok(vec)
        })]
        pub settlement_claims: Vec<SettlementClaimData>,
    }
    #[derive(Arbitrary, Debug)]
    pub struct SettlementClaimData {
        pub withdraw_authority: AccountId,
        pub stake_authority: AccountId,
        pub active_stake: u64,
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| -> arbitrary::Result<u64> {
            u.int_in_range(1..=u64::MAX)
        })]
        pub claim_amount: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct UpsizeSettlementClaims {
        pub accounts: UpsizeSettlementClaimsAccounts,
        pub data: UpsizeSettlementClaimsData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct UpsizeSettlementClaimsAccounts {
        pub settlement_claims: AccountId,
        pub rent_payer: AccountId,
        pub system_program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct UpsizeSettlementClaimsData {
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| u.int_in_range(81921..=80000000))]
        max_records: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CancelSettlement {
        pub accounts: CancelSettlementAccounts,
        pub data: CancelSettlementData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CancelSettlementAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub settlement: AccountId,
        pub settlement_claims: AccountId,
        pub authority: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub rent_collector: AccountId,
        pub split_rent_collector: AccountId,
        pub split_rent_refund_account: AccountId,
        pub clock: AccountId,
        pub stake_program: AccountId,
        pub stake_history: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CancelSettlementData {
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| u.int_in_range(1..=u64::MAX))]
        max_merkle_nodes: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct FundSettlement {
        pub accounts: FundSettlementAccounts,
        pub data: FundSettlementData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct FundSettlementAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub vote_account: AccountId,
        pub settlement: AccountId,
        pub operator_authority: AccountId,
        pub stake_account: AccountId,
        pub settlement_staker_authority: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub split_stake_account: AccountId,
        pub split_stake_rent_payer: AccountId,
        pub system_program: AccountId,
        pub stake_history: AccountId,
        pub clock: AccountId,
        pub rent: AccountId,
        pub stake_program: AccountId,
        pub stake_config: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct FundSettlementData {}
    #[derive(Arbitrary, Debug)]
    pub struct MergeStake {
        pub accounts: MergeStakeAccounts,
        pub data: MergeStakeData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct MergeStakeAccounts {
        pub config: AccountId,
        pub source_stake: AccountId,
        pub destination_stake: AccountId,
        pub staker_authority: AccountId,
        pub stake_history: AccountId,
        pub clock: AccountId,
        pub stake_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
        pub vote_account: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct MergeStakeData {
        pub settlement: AccountId,
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| u.int_in_range(LAMPORTS_PER_SOL*2..=u64::MAX/2))]
        pub source_stake_amount: u64,
        #[arbitrary(with = |u: &mut arbitrary::Unstructured| u.int_in_range(LAMPORTS_PER_SOL*2..=u64::MAX/2))]
        pub destination_stake_amount: u64,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ResetStake {
        pub accounts: ResetStakeAccounts,
        pub data: ResetStakeData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ResetStakeAccounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub settlement: AccountId,
        pub stake_account: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub vote_account: AccountId,
        pub stake_history: AccountId,
        pub stake_config: AccountId,
        pub clock: AccountId,
        pub stake_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ResetStakeData {}
    #[derive(Arbitrary, Debug)]
    pub struct WithdrawStake {
        pub accounts: WithdrawStakeAccounts,
        pub data: WithdrawStakeData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct WithdrawStakeAccounts {
        pub config: AccountId,
        pub operator_authority: AccountId,
        pub settlement: AccountId,
        pub stake_account: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub withdraw_to: AccountId,
        pub stake_history: AccountId,
        pub clock: AccountId,
        pub stake_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct WithdrawStakeData {}
    #[derive(Arbitrary, Debug)]
    pub struct EmergencyPause {
        pub accounts: EmergencyPauseAccounts,
        pub data: EmergencyPauseData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct EmergencyPauseAccounts {
        pub config: AccountId,
        pub pause_authority: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct EmergencyPauseData {}
    #[derive(Arbitrary, Debug)]
    pub struct EmergencyResume {
        pub accounts: EmergencyResumeAccounts,
        pub data: EmergencyResumeData,
    }
    #[derive(Arbitrary, Debug)]
    pub struct EmergencyResumeAccounts {
        pub config: AccountId,
        pub pause_authority: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct EmergencyResumeData {}
    #[derive(Arbitrary, Debug)]
    pub struct CloseSettlementV2 {
        pub accounts: CloseSettlementV2Accounts,
        pub data: CloseSettlementV2Data,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CloseSettlementV2Accounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub settlement: AccountId,
        pub settlement_claims: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub rent_collector: AccountId,
        pub split_rent_collector: AccountId,
        pub split_rent_refund_account: AccountId,
        pub clock: AccountId,
        pub stake_program: AccountId,
        pub stake_history: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct CloseSettlementV2Data {}
    #[derive(Arbitrary, Debug)]
    pub struct ClaimSettlementV2 {
        pub accounts: ClaimSettlementV2Accounts,
        pub data: ClaimSettlementV2Data,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ClaimSettlementV2Accounts {
        pub config: AccountId,
        pub bond: AccountId,
        pub settlement: AccountId,
        pub settlement_claims: AccountId,
        pub stake_account_from: AccountId,
        pub stake_account_to: AccountId,
        pub bonds_withdrawer_authority: AccountId,
        pub stake_history: AccountId,
        pub clock: AccountId,
        pub stake_program: AccountId,
        pub event_authority: AccountId,
        pub program: AccountId,
    }
    #[derive(Arbitrary, Debug)]
    pub struct ClaimSettlementV2Data {
        pub proof: Vec<[u8; 32]>,
        pub tree_node_hash: [u8; 32],
        pub stake_account_staker: AccountId,
        pub stake_account_withdrawer: AccountId,
        pub claim: u64,
        pub index: u64,
    }

    fn get_merkle_root(merkle_tree: &MerkleTreeMeta) -> [u8; 32] {
        if let Some(root) = merkle_tree.merkle_root {
            root.to_bytes()
        } else {
            [0; 32]
        }
    }

    impl<'info> IxOps<'info> for InitConfig {
        type IxData = validator_bonds::instruction::InitConfig;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = InitConfigSnapshot<'info>;
        fn get_data(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let operator_authority = fuzz_accounts.authorities.get_or_create_account(
                self.data.operator_authority,
                client,
                10 * LAMPORTS_PER_SOL,
            );
            let admin_authority = fuzz_accounts.authorities.get_or_create_account(
                self.data.admin_authority,
                client,
                LAMPORTS_PER_SOL,
            );
            let data = validator_bonds::instruction::InitConfig {
                init_config_args: validator_bonds::instructions::InitConfigArgs {
                    admin_authority: admin_authority.pubkey(),
                    operator_authority: operator_authority.pubkey(),
                    epochs_to_claim_settlement: self.data.epochs_to_claim_settlement,
                    withdraw_lockup_epochs: self.data.withdraw_lockup_epochs,
                    slots_to_start_settlement_claiming: self
                        .data
                        .slots_to_start_settlement_claiming,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = Keypair::new();
            let rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let acc_meta = validator_bonds::accounts::InitConfig {
                config: config.pubkey(),
                rent_payer: rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![rent_payer, config];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for ConfigureConfig {
        type IxData = validator_bonds::instruction::ConfigureConfig;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = ConfigureConfigSnapshot<'info>;
        fn get_data(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data_admin = self.data.admin.map(|admin| {
                fuzz_accounts
                    .authorities
                    .get_or_create_account(admin, client, LAMPORTS_PER_SOL)
                    .pubkey()
            });
            let data_operator = self.data.operator.map(|operator| {
                fuzz_accounts
                    .authorities
                    .get_or_create_account(operator, client, LAMPORTS_PER_SOL)
                    .pubkey()
            });
            let data_pause_authority = self.data.pause_authority.map(|pause_authority| {
                fuzz_accounts
                    .authorities
                    .get_or_create_account(pause_authority, client, LAMPORTS_PER_SOL)
                    .pubkey()
            });

            let data = validator_bonds::instruction::ConfigureConfig {
                configure_config_args: validator_bonds::instructions::ConfigureConfigArgs {
                    admin: data_admin,
                    operator: data_operator,
                    pause_authority: data_pause_authority,
                    epochs_to_claim_settlement: self.data.epochs_to_claim_settlement,
                    withdraw_lockup_epochs: self.data.withdraw_lockup_epochs,
                    minimum_stake_lamports: self.data.minimum_stake_lamports,
                    slots_to_start_settlement_claiming: self
                        .data
                        .slots_to_start_settlement_claiming,
                    min_bond_max_stake_wanted: self.data.min_bond_max_stake_wanted,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = get_or_create_config_account(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );

            let acc_meta = validator_bonds::accounts::ConfigureConfig {
                config: config.config.pubkey(),
                admin_authority: config.admin_authority.pubkey(),
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![config.admin_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for InitBond {
        type IxData = validator_bonds::instruction::InitBond;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = InitBondSnapshot<'info>;
        fn get_data(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let bond_authority = fuzz_accounts.authorities.get_or_create_account(
                self.data.bond_authority,
                client,
                LAMPORTS_PER_SOL,
            );
            let data = validator_bonds::instruction::InitBond {
                init_bond_args: validator_bonds::instructions::InitBondArgs {
                    bond_authority: bond_authority.pubkey(),
                    cpmpe: self.data.cpmpe,
                    max_stake_wanted: self.data.max_stake_wanted,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = get_or_create_config_account(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let (vote_account, _, node_pubkey) = fuzz_accounts.get_or_create_vote_account(
                client,
                self.accounts.validator_identity,
                self.accounts.vote_account,
            );
            let (bond, _) = find_bond_address(&config.config.pubkey(), &vote_account);

            let rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let acc_meta = validator_bonds::accounts::InitBond {
                config: config.config.pubkey(),
                vote_account,
                validator_identity: Some(node_pubkey.pubkey()),
                bond,
                rent_payer: rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![node_pubkey, rent_payer];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for ConfigureBond {
        type IxData = validator_bonds::instruction::ConfigureBond;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = ConfigureBondSnapshot<'info>;
        fn get_data(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let bond_authority = self.data.bond_authority.map(|ba| {
                fuzz_accounts
                    .authorities
                    .get_or_create_account(ba, client, LAMPORTS_PER_SOL)
                    .pubkey()
            });
            let data = validator_bonds::instruction::ConfigureBond {
                configure_bond_args: validator_bonds::instructions::ConfigureBondArgs {
                    bond_authority,
                    cpmpe: self.data.cpmpe,
                    max_stake_wanted: self.data.max_stake_wanted,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let acc_meta = validator_bonds::accounts::ConfigureBond {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                authority: bond.bond_authority.pubkey(),
                vote_account: bond.vote_account.pubkey(),
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![bond.bond_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for MintBond {
        type IxData = validator_bonds::instruction::MintBond;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = MintBondSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::MintBond {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let (mint_pubkey, _) =
                find_bond_mint(&bond.bond.pubkey(), &bond.node_identity.pubkey());
            let validator_identity_token_account =
                get_associated_token_address(&bond.node_identity.pubkey(), &mint_pubkey);
            let rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let (metadata, _) = Metadata::find_pda(&mint_pubkey);
            let acc_meta = validator_bonds::accounts::MintBond {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                mint: mint_pubkey,
                validator_identity: bond.node_identity.pubkey(),
                validator_identity_token_account,
                vote_account: bond.vote_account.pubkey(),
                metadata,
                rent_payer: rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
                token_program: anchor_spl::token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                metadata_program: anchor_spl::metadata::ID,
                rent: solana_sdk::sysvar::rent::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![rent_payer];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for FundBond {
        type IxData = validator_bonds::instruction::FundBond;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = FundBondSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::FundBond {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let (stake_account, stake_data) = get_or_create_delegated_stake_account(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.stake_account,
                self.accounts.stake_account,
                client,
                bond.vote_account.pubkey(),
                LAMPORTS_PER_SOL,
            );
            let acc_meta = validator_bonds::accounts::FundBond {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                bonds_withdrawer_authority: find_bonds_withdrawer_authority(
                    &config.config.pubkey(),
                )
                .0,
                stake_account,
                stake_authority: stake_data.withdrawer.pubkey(),
                clock: solana_sdk::sysvar::clock::ID,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![stake_data.withdrawer.clone()];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for ConfigureBondWithMint {
        type IxData = validator_bonds::instruction::ConfigureBondWithMint;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = ConfigureBondWithMintSnapshot<'info>;
        fn get_data(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let (bond, _) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let bond_authority = if let Some(ba) = self.data.bond_authority {
                Some(
                    fuzz_accounts
                        .authorities
                        .get_or_create_account(ba, client, LAMPORTS_PER_SOL)
                        .pubkey(),
                )
            } else {
                None
            };
            let data = validator_bonds::instruction::ConfigureBondWithMint {
                args: validator_bonds::instructions::ConfigureBondWithMintArgs {
                    validator_identity: bond.node_identity.pubkey(),
                    bond_authority,
                    cpmpe: self.data.cpmpe,
                    max_stake_wanted: self.data.max_stake_wanted,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let (mint, _) = Pubkey::find_program_address(
                &[
                    b"bond_mint",
                    bond.bond.pubkey.as_ref(),
                    bond.node_identity.pubkey().as_ref(),
                ],
                &validator_bonds::ID,
            );
            assert_eq!(
                mint,
                find_bond_mint(&bond.bond.pubkey(), &bond.node_identity.pubkey()).0
            );
            set_mint_account(client, &mint, u64::MAX, 0, &mint, None);
            let (token_account, token_authority) = fuzz_accounts.get_create_or_set_token(
                client,
                mint,
                1,
                self.accounts.token_account,
                self.accounts.token_authority,
            );

            let acc_meta = validator_bonds::accounts::ConfigureBondWithMint {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                mint,
                vote_account: bond.vote_account.pubkey(),
                token_account,
                token_authority: token_authority.pubkey(),
                token_program: anchor_spl::token::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![token_authority.clone()];
            Ok((signers, acc_meta))
        }
    }

    impl<'info> IxOps<'info> for InitWithdrawRequest {
        type IxData = validator_bonds::instruction::InitWithdrawRequest;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = InitWithdrawRequestSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::InitWithdrawRequest {
                create_withdraw_request_args:
                    validator_bonds::instructions::InitWithdrawRequestArgs {
                        amount: self.data.amount,
                    },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let acc_meta = validator_bonds::accounts::InitWithdrawRequest {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                vote_account: bond.vote_account.pubkey(),
                authority: bond.bond_authority.pubkey(),
                withdraw_request: find_withdraw_request_address(&bond.bond.pubkey()).0,
                rent_payer: rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![bond.bond_authority, rent_payer];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for CancelWithdrawRequest {
        type IxData = validator_bonds::instruction::CancelWithdrawRequest;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = CancelWithdrawRequestSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::CancelWithdrawRequest {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let withdraw_request = set_withdraw_request(
                client,
                bond.bond.pubkey(),
                bond.vote_account.pubkey(),
                0,
                None,
            );
            let rent_collector = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_collector,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let acc_meta = validator_bonds::accounts::CancelWithdrawRequest {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                vote_account: bond.vote_account.pubkey(),
                authority: bond.bond_authority.pubkey(),
                withdraw_request: withdraw_request.0,
                rent_collector: rent_collector.pubkey(),
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![bond.bond_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for ClaimWithdrawRequest {
        type IxData = validator_bonds::instruction::ClaimWithdrawRequest;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = ClaimWithdrawRequestSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::ClaimWithdrawRequest {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let withdraw_request = set_withdraw_request(
                client,
                bond.bond.pubkey(),
                bond.vote_account.pubkey(),
                self.data.withdraw_request_amount,
                Some(self.data.withdraw_request_withdrawn),
            );
            let withdrawer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.withdrawer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let split_stake_rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.split_stake_rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let split_stake = fuzz_accounts.stake_account.get_or_create_account(
                self.accounts.split_stake_account,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let withdrawer_bond = find_bonds_withdrawer_authority(&config.config.pubkey()).0;
            let stake_account = set_delegated_stake_account(
                client,
                bond.vote_account.pubkey(),
                withdrawer_bond,
                withdrawer_bond,
                self.data.stake_account_amount,
                0,
                None,
            );
            let acc_meta = validator_bonds::accounts::ClaimWithdrawRequest {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                vote_account: bond.vote_account.pubkey(),
                authority: bond.bond_authority.pubkey(),
                withdraw_request: withdraw_request.0,
                bonds_withdrawer_authority: bond.bond_authority.pubkey(),
                stake_account: stake_account.0.pubkey(),
                withdrawer: withdrawer.pubkey(),
                split_stake_account: split_stake.pubkey(),
                split_stake_rent_payer: split_stake_rent_payer.pubkey(),
                stake_program: anchor_lang::solana_program::stake::program::ID,
                system_program: solana_sdk::system_program::ID,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                clock: solana_sdk::sysvar::clock::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![bond.bond_authority, split_stake, split_stake_rent_payer];
            Ok((signers, acc_meta))
        }
    }

    impl InitSettlement {
        pub fn get_merkle_tree(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> MerkleTreeMeta {
            let vote_account = fuzz_accounts.vote_account.get_or_create_account(
                self.data.settlement_vote_account,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let mut claims_amount = self
                .data
                .settlement_claims
                .iter()
                .map(|c| c.claim_amount)
                .sum();
            // for init settlement is wrong to have 0 claims
            if claims_amount == 0 {
                claims_amount = 1;
            }
            let settlement = Settlement {
                reason: SettlementReason::Bidding,
                meta: SettlementMeta {
                    funder: SettlementFunder::ValidatorBond,
                },
                vote_account: vote_account.pubkey(),
                claims_count: self.data.settlement_claims.len(),
                claims_amount,
                claims: self
                    .data
                    .settlement_claims
                    .iter()
                    .map(|c| SettlementClaim {
                        withdraw_authority: fuzz_accounts
                            .authorities
                            .get_or_create_account(c.withdraw_authority, client, LAMPORTS_PER_SOL)
                            .pubkey(),
                        stake_authority: fuzz_accounts
                            .authorities
                            .get_or_create_account(c.stake_authority, client, LAMPORTS_PER_SOL)
                            .pubkey(),
                        stake_accounts: HashMap::new(),
                        active_stake: c.active_stake,
                        claim_amount: c.claim_amount,
                    })
                    .collect(),
            };
            generate_merkle_tree_meta(&settlement).unwrap()
        }
    }

    impl<'info> IxOps<'info> for InitSettlement {
        type IxData = validator_bonds::instruction::InitSettlement;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = InitSettlementSnapshot<'info>;
        fn get_data(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let merkle_tree = self.get_merkle_tree(client, fuzz_accounts);
            let rent_collector = fuzz_accounts.rent_payer.get_or_create_account(
                self.data.rent_collector,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let data = validator_bonds::instruction::InitSettlement {
                init_settlement_args: InitSettlementArgs {
                    merkle_root: get_merkle_root(&merkle_tree),
                    max_total_claim: merkle_tree.max_total_claim_sum,
                    max_merkle_nodes: merkle_tree.max_total_claims as u64,
                    rent_collector: rent_collector.pubkey(),
                    epoch: Clock::default().epoch,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let epoch = Clock::default().epoch;
            let merkle_tree = self.get_merkle_tree(client, fuzz_accounts);
            let (settlement, _) =
                find_settlement_address(&bond.bond.pubkey(), &get_merkle_root(&merkle_tree), epoch);
            let (settlement_claims, _) = find_settlement_claims_address(&settlement);
            let rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let acc_meta = validator_bonds::accounts::InitSettlement {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                settlement,
                settlement_claims,
                operator_authority: config.operator_authority.pubkey(),
                rent_payer: rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![config.operator_authority, rent_payer];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for UpsizeSettlementClaims {
        type IxData = validator_bonds::instruction::UpsizeSettlementClaims;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = UpsizeSettlementClaimsSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::UpsizeSettlementClaims {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let settlement = Pubkey::new_unique();
            let (settlement_claims, _) =
                set_settlement_claims(client, settlement, self.data.max_records, false);
            let acc_meta = validator_bonds::accounts::UpsizeSettlementClaims {
                settlement_claims,
                rent_payer: rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None);
            let signers = vec![rent_payer];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for CancelSettlement {
        type IxData = validator_bonds::instruction::CancelSettlement;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = CancelSettlementSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::CancelSettlement {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let max_merkle_nodes = self.data.max_merkle_nodes;
            let epoch = Clock::default().epoch;
            let (settlement, settlement_data) = set_settlement(
                client,
                bond.bond.pubkey(),
                [0; 32],
                1,
                max_merkle_nodes,
                epoch,
            );
            let (settlement_claims, _) =
                set_settlement_claims(client, settlement, max_merkle_nodes, true);
            let split_rent_collector = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.split_rent_collector,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let node_identity = client.set_account(LAMPORTS_PER_SOL);
            let (split_rent_refund_account, _) = get_or_create_vote_account(
                &mut fuzz_accounts.vote_account,
                self.accounts.split_rent_refund_account,
                client,
                node_identity.pubkey(),
            );
            let acc_meta = validator_bonds::accounts::CancelSettlement {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                settlement,
                settlement_claims,
                authority: config.operator_authority.pubkey(),
                bonds_withdrawer_authority: find_bonds_withdrawer_authority(
                    &config.config.pubkey(),
                )
                .0,
                rent_collector: settlement_data.rent_collector,
                split_rent_collector: split_rent_collector.pubkey(),
                split_rent_refund_account,
                clock: solana_sdk::sysvar::clock::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![config.operator_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for FundSettlement {
        type IxData = validator_bonds::instruction::FundSettlement;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = FundSettlementSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::FundSettlement {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let withdrawer_bond = config
                .config_account
                .bonds_withdrawer_authority(&config.config.pubkey())
                .unwrap();
            let (stake_account, _) = set_delegated_stake_account(
                client,
                bond.vote_account.pubkey(),
                withdrawer_bond,
                withdrawer_bond,
                LAMPORTS_PER_SOL * 10,
                Clock::default().epoch,
                None,
            );
            let max_records = 1;
            let (settlement, settlement_data) = set_settlement(
                client,
                bond.bond.pubkey(),
                [0; 32],
                1,
                max_records,
                Clock::default().epoch,
            );
            let split_stake_rent_payer = fuzz_accounts.rent_payer.get_or_create_account(
                self.accounts.split_stake_rent_payer,
                client,
                100 * LAMPORTS_PER_SOL,
            );
            let split_stake = Keypair::new();
            let acc_meta = validator_bonds::accounts::FundSettlement {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                vote_account: bond.bond_account.vote_account,
                settlement,
                operator_authority: config.operator_authority.pubkey(),
                stake_account: stake_account.pubkey(),
                settlement_staker_authority: settlement_data.staker_authority,
                bonds_withdrawer_authority: withdrawer_bond,
                split_stake_account: split_stake.pubkey(),
                split_stake_rent_payer: split_stake_rent_payer.pubkey(),
                system_program: solana_sdk::system_program::ID,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                clock: solana_sdk::sysvar::clock::ID,
                rent: solana_sdk::sysvar::rent::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                stake_config: solana_sdk::stake::config::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![
                config.operator_authority,
                split_stake,
                split_stake_rent_payer,
            ];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for MergeStake {
        type IxData = validator_bonds::instruction::MergeStake;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = MergeStakeSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::MergeStake {
                merge_args: MergeStakeArgs {
                    settlement: Pubkey::new_unique(),
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = get_or_create_config_account(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let (vote_account, _) = get_or_create_vote_account(
                &mut fuzz_accounts.vote_account,
                self.accounts.vote_account,
                client,
                Pubkey::new_unique(),
            );
            let (bonds_withdrawer_authority, _) =
                find_bonds_withdrawer_authority(&config.config.pubkey());
            let (source_stake, _) = set_delegated_stake_account(
                client,
                vote_account,
                bonds_withdrawer_authority,
                bonds_withdrawer_authority,
                self.data.source_stake_amount,
                Clock::default().epoch,
                None,
            );
            let (destination_stake, _) = set_delegated_stake_account(
                client,
                vote_account,
                bonds_withdrawer_authority,
                bonds_withdrawer_authority,
                self.data.destination_stake_amount,
                Clock::default().epoch,
                None,
            );
            let acc_meta = validator_bonds::accounts::MergeStake {
                config: config.config.pubkey(),
                source_stake: source_stake.pubkey(),
                destination_stake: destination_stake.pubkey(),
                staker_authority: bonds_withdrawer_authority,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                clock: solana_sdk::sysvar::clock::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for ResetStake {
        type IxData = validator_bonds::instruction::ResetStake;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = ResetStakeSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::ResetStake {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let acc_meta = validator_bonds::accounts::ResetStake {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                settlement: Pubkey::new_unique(),
                stake_account: Pubkey::new_unique(),
                bonds_withdrawer_authority: Pubkey::new_unique(),
                vote_account: bond.bond_account.vote_account,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                stake_config: solana_sdk::stake::config::ID,
                clock: solana_sdk::sysvar::clock::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for WithdrawStake {
        type IxData = validator_bonds::instruction::WithdrawStake;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = WithdrawStakeSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::WithdrawStake {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = get_or_create_config_account(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let acc_meta = validator_bonds::accounts::WithdrawStake {
                config: config.config.pubkey(),
                operator_authority: config.operator_authority.pubkey(),
                settlement: Pubkey::new_unique(),
                stake_account: Pubkey::new_unique(),
                bonds_withdrawer_authority: Pubkey::new_unique(),
                withdraw_to: Pubkey::new_unique(),
                stake_history: solana_sdk::sysvar::stake_history::ID,
                clock: solana_sdk::sysvar::clock::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![config.operator_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for EmergencyPause {
        type IxData = validator_bonds::instruction::EmergencyPause;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = EmergencyPauseSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::EmergencyPause {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = get_or_create_config_account(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let acc_meta = validator_bonds::accounts::EmergencyPauseResume {
                config: config.config.pubkey(),
                pause_authority: config.pause_authority.pubkey(),
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![config.pause_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for EmergencyResume {
        type IxData = validator_bonds::instruction::EmergencyResume;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = EmergencyResumeSnapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::EmergencyResume {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let config = set_config_with_modify(client, |c| {
                c.paused = true;
            });
            let acc_meta = validator_bonds::accounts::EmergencyPauseResume {
                config: config.config.pubkey(),
                pause_authority: config.pause_authority.pubkey(),
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![config.pause_authority];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for CloseSettlementV2 {
        type IxData = validator_bonds::instruction::CloseSettlementV2;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = CloseSettlementV2Snapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::CloseSettlementV2 {};
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let acc_meta = validator_bonds::accounts::CloseSettlementV2 {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                settlement: Pubkey::new_unique(),
                settlement_claims: Pubkey::new_unique(),
                bonds_withdrawer_authority: Pubkey::new_unique(),
                rent_collector: Pubkey::new_unique(),
                split_rent_collector: Pubkey::new_unique(),
                split_rent_refund_account: Pubkey::new_unique(),
                clock: solana_sdk::sysvar::clock::ID,
                stake_program: anchor_lang::solana_program::stake::program::ID,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![];
            Ok((signers, acc_meta))
        }
    }
    impl<'info> IxOps<'info> for ClaimSettlementV2 {
        type IxData = validator_bonds::instruction::ClaimSettlementV2;
        type IxAccounts = FuzzAccounts;
        type IxSnapshot = ClaimSettlementV2Snapshot<'info>;
        fn get_data(
            &self,
            _client: &mut impl FuzzClient,
            _fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<Self::IxData, FuzzingError> {
            let data = validator_bonds::instruction::ClaimSettlementV2 {
                claim_settlement_args: ClaimSettlementV2Args {
                    proof: vec![],
                    tree_node_hash: [0; 32],
                    stake_account_staker: Default::default(),
                    stake_account_withdrawer: Default::default(),
                    claim: 0,
                    index: 0,
                },
            };
            Ok(data)
        }
        fn get_accounts(
            &self,
            client: &mut impl FuzzClient,
            fuzz_accounts: &mut FuzzAccounts,
        ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
            let (bond, config) = get_or_create_bond_account_for_config(
                &mut fuzz_accounts.common_cache,
                &mut fuzz_accounts.bond,
                self.accounts.bond,
                &mut fuzz_accounts.config,
                self.accounts.config,
                client,
            );
            let acc_meta = validator_bonds::accounts::ClaimSettlementV2 {
                config: config.config.pubkey(),
                bond: bond.bond.pubkey(),
                settlement: Pubkey::new_unique(),
                settlement_claims: Pubkey::new_unique(),
                stake_account_from: Pubkey::new_unique(),
                stake_account_to: Pubkey::new_unique(),
                bonds_withdrawer_authority: Pubkey::new_unique(),
                stake_program: anchor_lang::solana_program::stake::program::ID,
                stake_history: solana_sdk::sysvar::stake_history::ID,
                clock: solana_sdk::sysvar::clock::ID,
                event_authority: find_event_authority().0,
                program: validator_bonds::ID,
            }
            .to_account_metas(None);
            let signers = vec![];
            Ok((signers, acc_meta))
        }
    }

    #[doc = r" Use AccountsStorage<T> where T can be one of:"]
    #[doc = r" Keypair, PdaStore, TokenStore, MintStore, ProgramStore"]
    #[derive(Default)]
    pub struct FuzzAccounts {
        common_cache: CommonCache,
        authorities: AccountsStorage<Keypair>,
        bond: AccountsStorage<PdaStore>,
        config: AccountsStorage<Keypair>,
        rent_payer: AccountsStorage<Keypair>,
        stake_account: AccountsStorage<Keypair>,
        validator_identity: AccountsStorage<Keypair>,
        validator_identity_token_account: AccountsStorage<TokenStore>,
        vote_account: AccountsStorage<Keypair>,
    }

    impl FuzzAccounts {
        pub fn get_or_create_vote_account(
            &mut self,
            client: &mut impl FuzzClient,
            validator_identity: AccountId,
            vote_account: AccountId,
        ) -> (Pubkey, VoteState, Keypair) {
            let mut validator_identity_keypair = self.validator_identity.get_or_create_account(
                validator_identity,
                client,
                LAMPORTS_PER_SOL,
            );
            let (vote_account, vote_state) = get_or_create_vote_account(
                &mut self.vote_account,
                vote_account,
                client,
                validator_identity_keypair.pubkey(),
            );
            if validator_identity_keypair.pubkey() != vote_state.node_pubkey {
                // search for the correct vote account keypair
                validator_identity_keypair = self
                    .validator_identity
                    .storage()
                    .iter()
                    .find(|(_, v)| v.pubkey() == vote_state.node_pubkey)
                    .unwrap()
                    .1
                    .clone();
            }
            (vote_account, vote_state, validator_identity_keypair)
        }

        pub fn get_create_or_set_token(
            &mut self,
            client: &mut impl FuzzClient,
            mint: Pubkey,
            amount: u64,
            validator_identity_token_account: AccountId,
            validator_identity_token_authority: AccountId,
        ) -> (Pubkey, Keypair) {
            let mut validator_identity_keypair = self.authorities.get_or_create_account(
                validator_identity_token_authority,
                client,
                LAMPORTS_PER_SOL,
            );
            let token_account_pubkey = self
                .validator_identity_token_account
                .get_or_create_account(
                    validator_identity_token_account,
                    client,
                    mint,
                    validator_identity_keypair.pubkey(),
                    amount,
                    None,
                    None,
                    0,
                    None,
                )
                .unwrap();
            let mut token_account_data =
                client.get_account(&token_account_pubkey).unwrap().unwrap();
            let token_account: TokenAccount = TokenAccount::try_deserialize_unchecked(
                &mut &*token_account_data.data.as_mut_slice(),
            )
            .unwrap();
            if validator_identity_keypair.pubkey() != token_account.owner {
                // search for the correct vote account keypair
                validator_identity_keypair = self
                    .authorities
                    .storage()
                    .iter()
                    .find(|(_, v)| v.pubkey() == token_account.owner)
                    .unwrap()
                    .1
                    .clone();
            }
            if token_account.amount < amount {
                info!(
                    "Setting token account with amount {}, to new amount {}",
                    token_account.amount, amount
                );
                set_token_account(
                    client,
                    &token_account_pubkey,
                    token_account.mint,
                    token_account.owner,
                    amount,
                    to_option(token_account.delegate),
                    to_option(token_account.is_native),
                    token_account.delegated_amount,
                    to_option(token_account.close_authority),
                );
            }
            (token_account_pubkey, validator_identity_keypair)
        }
    }
}
