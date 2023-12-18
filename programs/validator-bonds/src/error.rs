use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Program id in context does not match with the validator bonds id")]
    InvalidProgramId, // 6000 0x1770

    #[msg("Operation requires admin authority signature")]
    InvalidAdminAuthority, // 6001 0x1771

    #[msg("Invalid authority to operate with the withdraw request of validator bond account")]
    InvalidWithdrawRequestAuthority, // 6002 0x1772

    #[msg("Operation requires operator authority signature")]
    InvalidOperatorAuthority, // 6003 0x1773

    #[msg("Provided vote account is not owned by the validator vote program")]
    InvalidVoteAccountProgramId, // 6004 0x1774

    #[msg("Fail to create account address for Settlement")]
    InvalidSettlementAddress, // 6005 0x1775

    #[msg("Fail to create PDA address for Settlement Authority")]
    InvalidSettlementAuthorityAddress, // 6006 0x1776

    #[msg("Fail to create PDA address for Bonds Withdrawer Authority")]
    InvalidBondsWithdrawerAuthorityAddress, // 6007 0x1777

    #[msg("Fail to create program address for SettlementClaim")]
    InvalidSettlementClaimAddress, // 6008 0x1778

    #[msg("Fail to create program address for Bond")]
    InvalidBondAddress, // 6009 0x1779

    #[msg("Stake account's withdrawer does not match with the provided owner")]
    InvalidStakeOwner, // 6010 0x177a

    #[msg("Fail to create program address for WithdrawRequest")]
    InvalidWithdrawRequestAddress, // 6011 0x177b

    #[msg("Value of hundredth basis points is too big")]
    HundrethBasisPointsOverflow, // 6012 0x177c

    #[msg("Hundreth basis points calculation failure")]
    HundrethBasisPointsCalculation, // 6013 0x177d

    #[msg("Hundreth basis points failure to parse the value")]
    HundrethBasisPointsParse, // 6014 0x177e

    #[msg("Cannot deserialize validator vote account data")]
    FailedToDeserializeVoteAccount, // 6015 0x177f

    #[msg("Wrong authority for changing the validator bond account")]
    BondChangeNotPermitted, // 6016 0x1780

    #[msg("Provided stake cannot be used for bonds, it's not delegated")]
    StakeNotDelegated, // 6017 0x1781

    #[msg("Provided stake is delegated to a wrong validator vote account")]
    BondStakeWrongDelegation, // 6018 0x1782

    #[msg("Withdraw request has not elapsed the epoch lockup period yet")]
    WithdrawRequestNotReady, // 6019 0x1783

    #[msg("Settlement has not expired yet")]
    SettlementNotExpired, // 6020 0x1784

    #[msg("Settlement has already expired")]
    SettlementExpired, // 6021 0x1785

    #[msg("Stake is not initialized")]
    UninitializedStake, // 6022 0x1786

    #[msg("Stake account is not fully activated")]
    NoStakeOrNotFullyActivated, // 6023 0x1787

    #[msg("Instruction context was provided with unexpected set of remaining accounts")]
    UnexpectedRemainingAccounts, // 6024 0x1788

    #[msg("Closing SettlementClaim requires the settlement being closed")]
    SettlementNotClosed, // 6025 0x1789

    #[msg("Provided stake account has been already funded to a settlement")]
    StakeAccountAlreadyFunded, // 6026 0x178a

    #[msg("Settlement claim proof failed")]
    ClaimSettlementProofFailed, // 6027 0x178b

    #[msg("Provided stake account is locked-up")]
    StakeLockedUp, // 6028 0x178c

    #[msg("Stake account is not big enough to split")]
    StakeAccountNotBigEnoughToSplit, // 6029 0x178d

    #[msg("Claiming bigger amount than the max total claim")]
    ClaimAmountExceedsMaxTotalClaim, // 6030 0x178e

    #[msg("Claim exceeded number of claimable nodes in the merkle tree")]
    ClaimCountExceedsMaxNumNodes, // 6031 0x178f

    #[msg("Empty merkle tree, nothing to be claimed")]
    EmptySettlementMerkleTree, // 6032 0x1790

    #[msg("Provided stake account has not enough lamports to cover the claim")]
    ClaimingStakeAccountLamportsInsufficient, // 6033 0x1791

    #[msg("Provided stake account is not funded under a settlement")]
    StakeAccountNotFunded, // 6034 0x1792

    #[msg("Owner of validator vote account does not match with the provided owner signature")]
    ValidatorVoteAccountOwnerMismatch, // 6035 0x1793

    #[msg("Bond vote account address does not match with the provided validator vote account")]
    VoteAccountMismatch, // 6036 0x1794

    #[msg("Bond config address does not match with the provided config account")]
    ConfigAccountMismatch, // 6037 0x1795

    #[msg("Withdraw request vote account address does not match with the provided validator vote account")]
    WithdrawRequestVoteAccountMismatch, // 6038 0x1796

    #[msg("Bond account address does not match with the stored one")]
    BondAccountMismatch, // 6039 0x1797

    #[msg("Settlement account address does not match with the stored one")]
    SettlementAccountMismatch, // 6040 0x1798

    #[msg("Rent collector address does not match permitted rent collector")]
    RentCollectorMismatch, // 6041 0x1799

    #[msg("Stake account's staker does not match with the provided authority")]
    StakerAuthorityMismatch, // 6042 0x179a

    #[msg("Settlement stake account authority does not match with the provided stake account authority")]
    SettlementAuthorityMismatch, // 6043 0x179b

    #[msg("Delegation of provided stake account mismatches")]
    StakeDelegationMismatch, // 6044 0x179c
}
