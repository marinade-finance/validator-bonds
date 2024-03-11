import { ProgramAccount } from '@coral-xyz/anchor'
import {
  AccountInfo,
  EpochInfo,
  GetProgramAccountsFilter,
  PublicKey,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  Config,
  Bond,
  WithdrawRequest,
  bondAddress,
  withdrawRequestAddress,
  settlementAddress,
  Settlement,
  SettlementClaim,
  uintToBuffer,
  bondsWithdrawerAuthority,
} from './sdk'
import BN from 'bn.js'
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import {
  getAccountInfoAddresses,
  getMultipleAccounts,
  ProgramAccountInfoNoData,
  ProgramAccountWithInfoNullable,
} from './web3.js/accounts'
import { findStakeAccountNoDataInfos } from './web3.js'

// const CONFIG_ACCOUNT_DISCRIMINATOR = bs58.encode([155, 12, 170, 224, 30, 250, 204, 130])
const BOND_ACCOUNT_DISCRIMINATOR = bs58.encode([
  224, 128, 48, 251, 182, 246, 111, 196,
])
const WITHDRAW_REQUEST_ACCOUNT_DISCRIMINATOR = bs58.encode([
  186, 239, 174, 191, 189, 13, 47, 196,
])
const SETTLEMENT_ACCOUNT_DISCRIMINATOR = bs58.encode([
  55, 11, 219, 33, 36, 136, 40, 182,
])
const SETTLEMENT_CLAIM_ACCOUNT_DISCRIMINATOR = bs58.encode([
  216, 103, 231, 246, 171, 99, 124, 133,
])

// TODO: users can create arbitrary stake accounts (even with lockups), sdk must be prepared for that when showing total usable deposits
//       this is to check the non-locked, correctly delegated stake accounts, then not Settlement funded stake accounts
//       then subtract the the amount of possible existing WithdrawRequest (only one request per Bond)
//       alle this information should be printed in show command via CLI call

export async function getConfig(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<Config> {
  return program.account.config.fetch(address)
}

export async function findConfigs({
  program,
  adminAuthority,
  operatorAuthority,
}: {
  program: ValidatorBondsProgram
  adminAuthority?: PublicKey
  operatorAuthority?: PublicKey
}): Promise<ProgramAccount<Config>[]> {
  const filters = []
  if (adminAuthority) {
    filters.push({
      memcmp: {
        bytes: adminAuthority.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (operatorAuthority) {
    filters.push({
      memcmp: {
        bytes: operatorAuthority.toBase58(),
        // 8 anchor offset + first data 32B admin pubkey
        offset: 40,
      },
    })
  }
  return await program.account.config.all(filters)
}

export async function getBond(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<Bond> {
  return program.account.bond.fetch(address)
}

export async function getMultipleBonds({
  program,
  addresses,
}: {
  program: ValidatorBondsProgram
  addresses: PublicKey[]
}): Promise<ProgramAccountWithInfoNullable<Bond>[]> {
  return (
    await getMultipleAccounts({
      connection: program,
      addresses,
    })
  ).map(({ publicKey, account: accountInfo }) =>
    mapAccountInfoToProgramAccount<Bond>(
      program,
      accountInfo,
      publicKey,
      program.account.bond.idlAccount.name
    )
  )
}

export async function findBonds({
  program,
  configAccount,
  voteAccount,
  bondAuthority,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  voteAccount?: PublicKey
  bondAuthority?: PublicKey
}): Promise<ProgramAccount<Bond>[]> {
  if (configAccount && voteAccount) {
    const [bondAccount] = bondAddress(
      configAccount,
      voteAccount,
      program.programId
    )
    const bondData = await program.account.bond.fetch(bondAccount)
    return bondData ? [{ publicKey: bondAccount, account: bondData }] : []
  }
  const filters: GetProgramAccountsFilter[] = []
  if (configAccount) {
    filters.push({
      memcmp: {
        bytes: configAccount.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (voteAccount) {
    filters.push({
      memcmp: {
        bytes: voteAccount.toBase58(),
        // 8 anchor offset + first data 32B config pubkey
        offset: 40,
      },
    })
  }
  if (bondAuthority) {
    filters.push({
      memcmp: {
        bytes: bondAuthority.toBase58(),
        // 8 anchor offset + 32B config pubkey + 32B validator vote pubkey
        offset: 72,
      },
    })
  }

  filters.push({ memcmp: { bytes: BOND_ACCOUNT_DISCRIMINATOR, offset: 0 } })
  const addresses = await getAccountInfoAddresses({
    connection: program,
    programId: program.programId,
    filters,
  })
  return (await getMultipleBonds({ program, addresses }))
    .filter(d => d.account !== null)
    .map(d => d as ProgramAccount<Bond>)
}

export async function getWithdrawRequest(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<WithdrawRequest> {
  return program.account.withdrawRequest.fetch(address)
}

export async function getMultipleWithdrawRequests({
  program,
  addresses,
}: {
  program: ValidatorBondsProgram
  addresses: PublicKey[]
}): Promise<ProgramAccountWithInfoNullable<WithdrawRequest>[]> {
  return (
    await getMultipleAccounts({
      connection: program,
      addresses,
    })
  ).map(({ publicKey, account: accountInfo }) =>
    mapAccountInfoToProgramAccount<WithdrawRequest>(
      program,
      accountInfo,
      publicKey,
      program.account.withdrawRequest.idlAccount.name
    )
  )
}

export async function findWithdrawRequests({
  program,
  voteAccount,
  bond,
  epoch,
}: {
  program: ValidatorBondsProgram
  voteAccount?: PublicKey
  bond?: PublicKey
  epoch?: EpochInfo | number | BN | bigint
}): Promise<ProgramAccount<WithdrawRequest>[]> {
  if (bond) {
    const [withdrawRequestAccount] = withdrawRequestAddress(
      bond,
      program.programId
    )
    const withdrawRequestData =
      await program.account.withdrawRequest.fetchNullable(
        withdrawRequestAccount
      )
    return withdrawRequestData
      ? [{ publicKey: withdrawRequestAccount, account: withdrawRequestData }]
      : []
  }
  const filters = []
  if (voteAccount) {
    filters.push({
      memcmp: {
        bytes: voteAccount.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (epoch) {
    filters.push({
      memcmp: {
        bytes: bs58.encode(uintToBuffer(epoch)),
        // 8 anchor offset + 32B validator vote pubkey + 32B bond pubkey
        offset: 72,
      },
    })
  }
  filters.push({
    memcmp: { bytes: WITHDRAW_REQUEST_ACCOUNT_DISCRIMINATOR, offset: 0 },
  })
  const addresses = await getAccountInfoAddresses({
    connection: program,
    programId: program.programId,
    filters,
  })
  return (await getMultipleWithdrawRequests({ program, addresses }))
    .filter(d => d.account !== null)
    .map(d => d as ProgramAccount<WithdrawRequest>)
}

export async function getSettlement(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<Settlement> {
  return program.account.settlement.fetch(address)
}

export async function getMultipleSettlements({
  program,
  addresses,
}: {
  program: ValidatorBondsProgram
  addresses: PublicKey[]
}): Promise<ProgramAccountWithInfoNullable<Settlement>[]> {
  return (
    await getMultipleAccounts({
      connection: program,
      addresses,
    })
  ).map(({ publicKey, account: accountInfo }) =>
    mapAccountInfoToProgramAccount<Settlement>(
      program,
      accountInfo,
      publicKey,
      program.account.settlement.idlAccount.name
    )
  )
}

export async function findSettlements({
  program,
  bond,
  merkleRoot,
  epoch,
}: {
  program: ValidatorBondsProgram
  bond?: PublicKey
  merkleRoot?: Uint8Array | Buffer | number[]
  epoch?: number | BN | EpochInfo
}): Promise<ProgramAccount<Settlement>[]> {
  if (bond && merkleRoot && epoch) {
    const [settlementAccount] = settlementAddress(
      bond,
      merkleRoot,
      epoch,
      program.programId
    )
    const settlementData =
      await program.account.settlement.fetchNullable(settlementAccount)
    return settlementData
      ? [{ publicKey: settlementAccount, account: settlementData }]
      : []
  }
  const filters = []
  if (bond) {
    filters.push({
      memcmp: {
        bytes: bond.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (merkleRoot) {
    filters.push({
      memcmp: {
        bytes: bs58.encode(merkleRoot),
        // 8 anchor offset + 32B bond pubkey + 32B settlement authority
        offset: 72,
      },
    })
  }
  filters.push({
    memcmp: { bytes: SETTLEMENT_ACCOUNT_DISCRIMINATOR, offset: 0 },
  })
  const addresses = await getAccountInfoAddresses({
    connection: program,
    programId: program.programId,
    filters,
  })
  return (await getMultipleSettlements({ program, addresses }))
    .filter(d => d.account !== null)
    .map(d => d as ProgramAccount<Settlement>)
}

export async function getSettlementClaim(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<SettlementClaim> {
  return program.account.settlementClaim.fetch(address)
}

export async function getMultipleSettlementClaims({
  program,
  addresses,
}: {
  program: ValidatorBondsProgram
  addresses: PublicKey[]
}): Promise<ProgramAccountWithInfoNullable<SettlementClaim>[]> {
  return (
    await getMultipleAccounts({
      connection: program,
      addresses,
    })
  ).map(({ publicKey, account: accountInfo }) =>
    mapAccountInfoToProgramAccount<SettlementClaim>(
      program,
      accountInfo,
      publicKey,
      program.account.settlementClaim.idlAccount.name
    )
  )
}

export async function findSettlementClaims({
  program,
  settlement,
  stakeAccountStaker,
  stakeAccountWithdrawer,
}: {
  program: ValidatorBondsProgram
  settlement?: PublicKey
  stakeAccountStaker?: PublicKey
  stakeAccountWithdrawer?: PublicKey
}): Promise<ProgramAccount<SettlementClaim>[]> {
  const filters = []
  if (settlement) {
    filters.push({
      memcmp: {
        bytes: settlement.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (stakeAccountStaker) {
    filters.push({
      memcmp: {
        bytes: stakeAccountStaker.toBase58(),
        // 8 anchor offset + settlement 32B + stake account to 32B
        offset: 72,
      },
    })
  }
  if (stakeAccountWithdrawer) {
    filters.push({
      memcmp: {
        bytes: stakeAccountWithdrawer.toBase58(),
        // 8 anchor offset + 32B settlement + stake acc. to 32B + 32B staker
        offset: 104,
      },
    })
  }

  filters.push({
    memcmp: { bytes: SETTLEMENT_CLAIM_ACCOUNT_DISCRIMINATOR, offset: 0 },
  })
  const addresses = await getAccountInfoAddresses({
    connection: program,
    programId: program.programId,
    filters,
  })
  return (await getMultipleSettlementClaims({ program, addresses }))
    .filter(d => d.account !== null)
    .map(d => d as ProgramAccount<SettlementClaim>)
}

async function findStakeAccountsHelper({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  withdrawer,
  staker,
}: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  withdrawer?: PublicKey
  staker?: PublicKey
}): Promise<ProgramAccountInfoNoData[]> {
  if (!bondAccount && voteAccount) {
    bondAccount = bondAddress(configAccount, voteAccount, program.programId)[0]
  } else if (!bondAccount) {
    throw new Error(
      'getBondData: bondAccount or (voteAccount and configAccount) must be provided'
    )
  }
  if (withdrawer === undefined) {
    ;[withdrawer] = bondsWithdrawerAuthority(configAccount, program.programId)
  }
  if (voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = bondData.voteAccount
  }
  return await findStakeAccountNoDataInfos({
    connection: program,
    withdrawer,
    staker,
    voter: voteAccount,
  })
}

export async function findBondStakeAccounts(args: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<ProgramAccountInfoNoData[]> {
  return findStakeAccountsHelper(args)
}

export async function findBondNonSettlementStakeAccounts(args: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<ProgramAccountInfoNoData[]> {
  const [withdrawerAuthority] = bondsWithdrawerAuthority(
    args.configAccount,
    args.program.programId
  )
  return findStakeAccountsHelper({ ...args, staker: withdrawerAuthority })
}

export async function getBondFunding({
  program,
  configAccount,
  bondAccount,
  voteAccount,
}: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<{
  amountBond: BN
  amountAtStakeAccounts: BN
  bondNonSettlementStakeAccounts: ProgramAccountInfoNoData[]
  withdrawRequest: ProgramAccount<WithdrawRequest> | undefined
}> {
  const bondNonSettlementStakeAccounts =
    await findBondNonSettlementStakeAccounts({
      program,
      configAccount,
      bondAccount,
      voteAccount,
    })
  const amountAtStakeAccounts = bondNonSettlementStakeAccounts.reduce(
    (sum, { account }) => sum.addn(account.lamports),
    new BN(0)
  )
  const withdrawRequest = (
    await findWithdrawRequests({ program, bond: bondAccount })
  ).find(withdrawRequest => withdrawRequest)

  let amountBond = amountAtStakeAccounts
  if (withdrawRequest !== undefined) {
    amountBond = amountAtStakeAccounts
      .sub(withdrawRequest.account.requestedAmount)
      .add(withdrawRequest.account.withdrawnAmount)
  }

  return {
    amountBond,
    amountAtStakeAccounts,
    bondNonSettlementStakeAccounts,
    withdrawRequest,
  }
}

function mapAccountInfoToProgramAccount<T>(
  program: ValidatorBondsProgram,
  accountInfo: AccountInfo<Buffer> | null,
  publicKey: PublicKey,
  programAccountName: string
): ProgramAccountWithInfoNullable<T> {
  return {
    publicKey,
    account: accountInfo
      ? program.coder.accounts.decode<T>(programAccountName, accountInfo.data)
      : null,
    accountInfo,
  }
}
