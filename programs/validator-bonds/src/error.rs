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

    #[msg("Provided vote account is trouble to deserialize")]
    InvalidStakeAccountState, // 6005 0x1775

    #[msg("Provided stake account is not owned by the stake account program")]
    InvalidStakeAccountProgramId, // 6006 0x1776

    #[msg("Fail to create account address for Settlement")]
    InvalidSettlementAddress, // 6007 0x1777

    #[msg("Fail to create PDA address for Settlement Authority")]
    InvalidSettlementAuthorityAddress, // 6008 0x1778

    #[msg("Fail to create PDA address for Bonds Withdrawer Authority")]
    InvalidBondsWithdrawerAuthorityAddress, // 6009 0x1779

    #[msg("Fail to create program address for SettlementClaim")]
    InvalidSettlementClaimAddress, // 6010 0x177a

    #[msg("Fail to create program address for Bond")]
    InvalidBondAddress, // 6011 0x177b

    #[msg("Wrong withdrawer authority of the stake account")]
    WrongStakeAccountWithdrawer, // 6012 0x177c

    #[msg("Fail to create program address for WithdrawRequest")]
    InvalidWithdrawRequestAddress, // 6013 0x177d

    // note: not used
    #[msg("Value of hundredth basis points is too big")]
    HundredthBasisPointsOverflow, // 6014 0x177e

    // note: not used
    #[msg("Hundredth basis points calculation failure")]
    HundredthBasisPointsCalculation, // 6015 0x177f

    // note: not used
    #[msg("Hundredth basis points failure to parse the value")]
    HundredthBasisPointsParse, // 6016 0x1780

    #[msg("Cannot deserialize validator vote account data")]
    FailedToDeserializeVoteAccount, // 6017 0x1781

    #[msg("Wrong authority for changing the validator bond account")]
    BondChangeNotPermitted, // 6018 0x1782

    #[msg("Provided stake cannot be used for bonds, it's not delegated")]
    StakeNotDelegated, // 6019 0x1783

    #[msg("Provided stake is delegated to a wrong validator vote account")]
    BondStakeWrongDelegation, // 6020 0x1784

    #[msg("Withdraw request has not elapsed the epoch lockup period yet")]
    WithdrawRequestNotReady, // 6021 0x1785

    #[msg("Settlement has not expired yet")]
    SettlementNotExpired, // 6022 0x1786

    #[msg("Settlement has already expired")]
    SettlementExpired, // 6023 0x1787

    #[msg("Stake is not initialized")]
    UninitializedStake, // 6024 0x1788

    #[msg("Stake account is not fully activated")]
    NoStakeOrNotFullyActivated, // 6025 0x1789

    #[msg("Instruction context was provided with unexpected set of remaining accounts")]
    UnexpectedRemainingAccounts, // 6026 0x178a

    #[msg("Required settlement to be closed")]
    SettlementNotClosed, // 6027 0x178b

    #[msg("Provided stake account has been already funded to a settlement")]
    StakeAccountIsFundedToSettlement, // 6028 0x178c

    #[msg("Settlement claim proof failed")]
    ClaimSettlementProofFailed, // 6029 0x178d

    #[msg("Provided stake account is locked-up")]
    StakeLockedUp, // 6030 0x178e

    #[msg("Stake account is not big enough to be split")]
    StakeAccountNotBigEnoughToSplit, // 6031 0x178f

    #[msg("Claiming bigger amount than the max total claim")]
    ClaimAmountExceedsMaxTotalClaim, // 6032 0x1790

    #[msg("Claim exceeded number of claimable nodes in the merkle tree")]
    ClaimCountExceedsMaxMerkleNodes, // 6033 0x1791

    #[msg("Empty merkle tree, nothing to be claimed")]
    EmptySettlementMerkleTree, // 6034 0x1792

    #[msg("Provided stake account has not enough lamports to cover the claim")]
    ClaimingStakeAccountLamportsInsufficient, // 6035 0x1793

    #[msg("Provided stake account is not funded under the settlement")]
    StakeAccountNotFundedToSettlement, // 6036 0x1794

    #[msg("Validator vote account does not match to provided validator identity signature")]
    VoteAccountValidatorIdentityMismatch, // 6037 0x1795

    #[msg("Bond vote account address does not match with the provided validator vote account")]
    VoteAccountMismatch, // 6038 0x1796

    #[msg("Bond config address does not match with the provided config account")]
    ConfigAccountMismatch, // 6039 0x1797

    #[msg("Withdraw request vote account address does not match with the provided validator vote account")]
    WithdrawRequestVoteAccountMismatch, // 6040 0x1798

    #[msg("Bond account address does not match with the stored one")]
    BondAccountMismatch, // 6041 0x1799

    #[msg("Settlement account address does not match with the stored one")]
    SettlementAccountMismatch, // 6042 0x179a

    #[msg("Rent collector address does not match permitted rent collector")]
    RentCollectorMismatch, // 6043 0x179b

    #[msg("Stake account's staker does not match with the provided authority")]
    StakerAuthorityMismatch, // 6044 0x179c

    #[msg("One or both stake authorities does not belong to bonds program")]
    NonBondStakeAuthorities, // 6045 0x179d

    #[msg("Stake account staker authority mismatches with the settlement authority")]
    SettlementAuthorityMismatch, // 6046 0x179e

    #[msg("Delegation of provided stake account mismatches")]
    StakeDelegationMismatch, // 6047 0x179f

    #[msg("Too small non-withdrawn withdraw request amount, cancel and init new one")]
    WithdrawRequestAmountTooSmall, // 6048 0x17a0

    #[msg("Withdraw request has been already fulfilled")]
    WithdrawRequestAlreadyFulfilled, // 6049 0x17a1

    #[msg("Claim settlement merkle tree node mismatch")]
    ClaimSettlementMerkleTreeNodeMismatch, // 6050 0x17a2

    #[msg("Wrong staker authority of the stake account")]
    WrongStakeAccountStaker, // 6051 0x17a3

    #[msg("Requested pause and already Paused")]
    AlreadyPaused, // 6052 0x17a4

    #[msg("Requested resume, but not Paused")]
    NotPaused, // 6053 0x17a5

    #[msg("Emergency Pause is Active")]
    ProgramIsPaused, // 6054 0x17a6

    #[msg("Invalid pause authority")]
    InvalidPauseAuthority, // 6055 0x17a7
}
