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
  ProgramAccountInfo,
  ProgramAccountInfoNoData,
  ProgramAccountWithInfoNullable,
} from './web3.js/accounts'
import { findStakeAccounts, StakeAccountParsed } from './web3.js'
import assert from 'assert'

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

const ZERO_BN = new BN(0)

// TODO: CHECK about non-locked stake accounts!!!

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
      connection: program.provider.connection,
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
    connection: program.provider.connection,
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
      connection: program.provider.connection,
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
    connection: program.provider.connection,
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
      connection: program.provider.connection,
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
    connection: program.provider.connection,
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
      connection: program.provider.connection,
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
    connection: program.provider.connection,
    programId: program.programId,
    filters,
  })
  return (await getMultipleSettlementClaims({ program, addresses }))
    .filter(d => d.account !== null)
    .map(d => d as ProgramAccount<SettlementClaim>)
}

function parseNotLocked(
  stakeAccounts: ProgramAccountInfo<StakeAccountParsed>[]
): ProgramAccountInfo<StakeAccountParsed>[] {
  return stakeAccounts.filter(
    stakeAccount => !stakeAccount.account.data.isLockedUp
  )
}

export async function findConfigStakeAccounts({
  program,
  configAccount,
  withdrawer,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  withdrawer?: PublicKey
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
  if (withdrawer === undefined && configAccount === undefined) {
    throw new Error(
      'findConfigStakeAccounts: configAccount or withdrawer must be provided'
    )
  }
  if (withdrawer === undefined) {
    assert(configAccount !== undefined, 'configAccount is known here')
    ;[withdrawer] = bondsWithdrawerAuthority(configAccount, program.programId)
  }
  const stakeAccounts = await findStakeAccounts({
    connection: program.provider.connection,
    withdrawer,
  })
  // for stake accounts considered to be under the bond, we consider it cannot be locked
  return parseNotLocked(stakeAccounts)
}

async function findBondStakeAccountsHelper({
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
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
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
  const stakeAccounts = await findStakeAccounts({
    connection: program.provider.connection,
    withdrawer,
    staker,
    voter: voteAccount,
  })
  // for stake accounts considered to be under the bond, we consider it cannot be locked
  return parseNotLocked(stakeAccounts)
}

export async function findBondStakeAccounts(args: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
  return findBondStakeAccountsHelper(args)
}

export async function findBondNonSettlementStakeAccounts(args: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
  const [withdrawerAuthority] = bondsWithdrawerAuthority(
    args.configAccount,
    args.program.programId
  )
  return findBondStakeAccountsHelper({ ...args, staker: withdrawerAuthority })
}

export type BondFunding = {
  bondAccount: PublicKey
  voteAccount: PublicKey
  amountActive: BN
  amountAtSettlements: BN
  amountToWithdraw: BN
  withdrawRequest: ProgramAccount<WithdrawRequest> | undefined
}

function calculateFundedAmount(
  stakeAccounts:
    | ProgramAccountInfoNoData[]
    | ProgramAccountInfo<StakeAccountParsed>[],
  withdrawRequest: ProgramAccount<WithdrawRequest> | undefined
): { stakeAccountsAmount: BN; withdrawRequestAmount: BN; amount: BN } {
  const stakeAccountsAmount = stakeAccounts
    .map(stakeAccount => stakeAccount.account.lamports)
    .reduce((sum, lamports) => sum.add(new BN(lamports)), ZERO_BN)
  const withdrawRequestAmount = (
    withdrawRequest?.account.requestedAmount ?? ZERO_BN
  ).sub(withdrawRequest?.account.withdrawnAmount ?? ZERO_BN)
  const amount = stakeAccountsAmount.sub(withdrawRequestAmount)
  return { stakeAccountsAmount, withdrawRequestAmount, amount }
}

export async function getBondsFunding({
  program,
  configAccount,
  bondAccounts,
  voteAccounts,
}: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  bondAccounts: (PublicKey | undefined)[]
  voteAccounts: (PublicKey | undefined)[]
}): Promise<BondFunding[]> {
  if (bondAccounts.length !== voteAccounts.length) {
    throw new Error('getBondsFunding: bondAccounts and voteAccounts must match')
  }
  for (let i = 0; i < bondAccounts.length; i++) {
    if (bondAccounts[i] === undefined && voteAccounts[i] === undefined) {
      throw new Error(
        'getBondsFunding: bondAccounts or voteAccounts must be provided for every record'
      )
    }
  }
  const inputData: Map<
    string,
    {
      voteAccount: PublicKey
      withdrawRequest?: ProgramAccount<WithdrawRequest>
    }
  > = new Map()
  // derive all bond addresses
  for (let i = 0; i < bondAccounts.length; i++) {
    let bondAccountAddress = bondAccounts[i]
    const voteAccountAddress = voteAccounts[i]
    if (bondAccounts[i] === undefined && voteAccountAddress !== undefined) {
      bondAccountAddress = bondAddress(
        configAccount,
        voteAccountAddress,
        program.programId
      )[0]
    }
    assert(
      bondAccountAddress !== undefined,
      'bond account address is known here'
    )
    inputData.set(bondAccountAddress.toBase58(), {
      voteAccount: voteAccountAddress ?? PublicKey.default,
    })
  }

  // searching for all vote accounts for each bond
  const bondsWithUnknownVoteAccount = Array.from(inputData.values())
    .filter(({ voteAccount }) => voteAccount.equals(PublicKey.default))
    .map(({ voteAccount }) => voteAccount)
  const bondsDataWithUnknownVoteAccount = await getMultipleBonds({
    program,
    addresses: bondsWithUnknownVoteAccount,
  })
  for (const bondData of bondsDataWithUnknownVoteAccount) {
    if (bondData.account === null) {
      throw new Error(
        'getBondsFunding: cannot get bond data for bond address ' +
          bondData.publicKey.toBase58() +
          '; required for vote account derivation'
      )
    }
    const bondInnerSetData = inputData.get(bondData.publicKey.toBase58())
    assert(bondInnerSetData !== undefined, 'bondInnerSetData is known here')
    bondInnerSetData.voteAccount = bondData.account.voteAccount
  }
  // getting info on withdraw requests for each bond (maybe it does not exist)
  const withdrawRequestAddresses = Array.from(inputData.keys()).map(
    bondAccount =>
      withdrawRequestAddress(new PublicKey(bondAccount), program.programId)[0]
  )
  const withdrawRequestsData = await getMultipleWithdrawRequests({
    program,
    addresses: withdrawRequestAddresses,
  })
  for (const withdrawRequestData of withdrawRequestsData) {
    if (
      withdrawRequestData.account === null ||
      withdrawRequestData.accountInfo === null
    ) {
      continue
    }
    const bondInnerSetData = inputData.get(
      withdrawRequestData.account.bond.toBase58()
    )
    assert(bondInnerSetData !== undefined, 'bondInnerSetData is known here')
    // we know the account is not null, i.e., we can set it as ProgramAccount instead of ProgramAccountNullable
    bondInnerSetData.withdrawRequest = {
      publicKey: withdrawRequestData.publicKey,
      account: withdrawRequestData.account,
    }
  }
  // get bond related stake accounts to find the funding
  const allStakeAccounts = await findConfigStakeAccounts({
    program,
    configAccount,
  })
  // const allStakeAccountsMap: Map<
  //   string,
  //   ProgramAccountInfo<StakeAccountParsed>[]
  // > =

  const bondFundedStakeAccounts = allStakeAccounts
    // filter OUT the stake accounts that are in a settlement
    .filter(
      stakeAccount =>
        stakeAccount.account.data.voter !== null &&
        stakeAccount.account.data.withdrawer !== null &&
        stakeAccount.account.data.staker !== null &&
        stakeAccount.account.data.withdrawer.equals(
          stakeAccount.account.data.staker
        )
    )
  const settlementsStakeAccounts = allStakeAccounts
    // filter for the stake accounts that are IN a settlement
    .filter(
      stakeAccount =>
        stakeAccount.account.data.withdrawer !== null &&
        stakeAccount.account.data.staker !== null &&
        !stakeAccount.account.data.withdrawer.equals(
          stakeAccount.account.data.staker
        )
    )
  const bondFundedStakeAccountsMap = groupByVoter(bondFundedStakeAccounts)
  const settlementsStakeAccountsMap = groupByVoter(settlementsStakeAccounts)

  return Array.from(inputData.entries()).map(
    ([bondAccount, { voteAccount, withdrawRequest }]) => {
      const bondFunded =
        bondFundedStakeAccountsMap.get(voteAccount.toBase58()) ??
        ([] as ProgramAccountInfo<StakeAccountParsed>[])
      const settlementFunded =
        settlementsStakeAccountsMap.get(voteAccount.toBase58()) ??
        ([] as ProgramAccountInfo<StakeAccountParsed>[])

      const { amount: amountActive, withdrawRequestAmount: amountToWithdraw } =
        calculateFundedAmount(bondFunded, withdrawRequest)
      const { amount: amountAtSettlements } = calculateFundedAmount(
        settlementFunded,
        undefined
      )

      return {
        bondAccount: new PublicKey(bondAccount),
        voteAccount,
        amountActive,
        amountAtSettlements,
        amountToWithdraw,
        withdrawRequest,
      }
    }
  )
}

function groupByVoter(
  stakeAccounts: ProgramAccountInfo<StakeAccountParsed>[]
): Map<string, ProgramAccountInfo<StakeAccountParsed>[]> {
  // group by vote account
  return stakeAccounts.reduce((acc, obj) => {
    const voter = obj.account.data.voter! // voter is known here, filtered above
    const stakeAccounts = acc.get(voter.toBase58())
    if (stakeAccounts === undefined) {
      acc.set(voter.toBase58(), [obj])
    } else {
      stakeAccounts.push(obj)
    }
    return acc
  }, new Map())
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
