import assert from 'assert'

import {
  ExecutionError,
  getVoteAccountFromData,
  pubkey,
  signer,
} from '@marinade.finance/web3js-1x'
import {
  Authorized,
  Keypair,
  StakeProgram,
  SystemProgram,
  VoteProgram,
  TransactionInstruction,
  StakeAuthorizationLayout,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import BN from 'bn.js'

import {
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
  deserializeStakeState,
  getRentExemptVote,
  VOTE_ACCOUNT_SIZE,
  getRentExemptStake,
} from '../../src'

import type { ValidatorBondsProgram } from '../../src'
import type { Provider } from '@coral-xyz/anchor'
import type { StakeState } from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { ExtendedProvider } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { AccountInfo, Lockup, Transaction, Signer } from '@solana/web3.js'

/**
 * SetLockup stake instruction params
 *
 *  - If a lockup is not active, the withdraw authority or custodian may set a new lockup
 *  - If a lockup is active, the lockup custodian may update the lockup parameters
 */
export type SetLockupStakeParams = {
  stakePubkey: PublicKey
  authorizedPubkey: PublicKey
  unixTimestamp?: number
  epoch?: number
  custodian?: PublicKey
}

export function setLockup(
  params: SetLockupStakeParams,
): TransactionInstruction {
  const { stakePubkey, authorizedPubkey, unixTimestamp, epoch, custodian } =
    params

  const keys = [
    // Initialized stake account
    { pubkey: stakePubkey, isSigner: false, isWritable: true },
    //  Lockup authority or withdraw authority
    { pubkey: authorizedPubkey, isSigner: true, isWritable: false },
  ]

  const instructionIndex = 6
  const instructionBuf = Buffer.alloc(4)
  instructionBuf.writeUInt32LE(instructionIndex, 0)
  let timestampBuf = Buffer.from([0])
  if (unixTimestamp) {
    timestampBuf = Buffer.alloc(9)
    timestampBuf.writeUInt8(1, 0)
    timestampBuf.writeBigInt64LE(BigInt(unixTimestamp), 1)
  }
  let epochBuf = Buffer.from([0])
  if (epoch) {
    epochBuf = Buffer.alloc(9)
    epochBuf.writeUInt8(1, 0)
    epochBuf.writeBigInt64LE(BigInt(epoch), 1)
  }
  let custodianBuf = Buffer.from([0])
  if (custodian) {
    custodianBuf = Buffer.alloc(33)
    custodianBuf.writeUInt8(1, 0)
    custodianBuf.set(custodian.toBuffer(), 1)
  }

  const instructionData = {
    keys,
    programId: StakeProgram.programId,
    data: Buffer.from([
      ...instructionBuf,
      ...timestampBuf,
      ...epochBuf,
      ...custodianBuf,
    ]),
  }
  return new TransactionInstruction(instructionData)
}

export enum StakeStates {
  Uninitialized,
  Initialized,
  Delegated,
  RewardsPool,
}

export async function getAndCheckStakeAccount(
  provider: Provider,
  account: PublicKey,
  stakeStateCheck?: StakeStates,
): Promise<[StakeState, AccountInfo<Buffer>]> {
  let accountInfo: AccountInfo<Buffer>
  try {
    accountInfo = (await provider.connection.getAccountInfo(
      account,
    )) as AccountInfo<Buffer>
  } catch (e) {
    console.error(e)
    throw new Error(`Account ${account.toBase58()} does not exist on chain`)
  }
  expect(accountInfo).toBeDefined()
  assert(accountInfo)
  expect(accountInfo.owner).toEqual(StakeProgram.programId)
  const stakeData = deserializeStakeState(accountInfo.data)
  switch (stakeStateCheck) {
    case StakeStates.Uninitialized:
      expect(stakeData.Uninitialized).toBeDefined()
      break
    case StakeStates.Initialized:
      expect(stakeData.Initialized).toBeDefined()
      break
    case StakeStates.Delegated:
      expect(stakeData.Stake).toBeDefined()
      break
    case StakeStates.RewardsPool:
      expect(stakeData.RewardsPool).toBeDefined()
      break
  }
  return [stakeData, accountInfo]
}

// ----- ENHANCED PROVIDER -----
export type VoteAccountKeys = {
  voteAccount: PublicKey
  validatorIdentity: Keypair
  authorizedVoter: Keypair
  authorizedWithdrawer: Keypair
}

export async function createVoteAccountWithIdentity(
  provider: ExtendedProvider,
  validatorIdentity: Keypair,
): Promise<VoteAccountKeys> {
  return await createVoteAccount({
    provider,
    validatorIdentity,
  })
}

export async function createVoteAccount({
  provider,
  rentExempt,
  authorizedVoter,
  authorizedWithdrawer,
  validatorIdentity,
  voteAccount = Keypair.generate(),
}: {
  provider: ExtendedProvider
  rentExempt?: number
  authorizedVoter?: Keypair
  authorizedWithdrawer?: Keypair
  validatorIdentity?: Keypair
  voteAccount?: Keypair
}): Promise<VoteAccountKeys> {
  rentExempt = await getRentExemptVote(provider, rentExempt)
  validatorIdentity = validatorIdentity ?? Keypair.generate()
  authorizedVoter = authorizedVoter ?? Keypair.generate()
  authorizedWithdrawer = authorizedWithdrawer ?? Keypair.generate()

  const ixCreate = SystemProgram.createAccount({
    fromPubkey: provider.walletPubkey,
    newAccountPubkey: voteAccount.publicKey,
    lamports: rentExempt,
    space: VOTE_ACCOUNT_SIZE,
    programId: VoteProgram.programId,
  })
  const ixInitialize = VoteProgram.initializeAccount({
    votePubkey: voteAccount.publicKey,
    nodePubkey: validatorIdentity.publicKey,
    voteInit: {
      authorizedVoter: authorizedVoter.publicKey,
      authorizedWithdrawer: authorizedWithdrawer.publicKey,
      commission: 0,
      nodePubkey: validatorIdentity.publicKey,
    },
  })

  await provider.sendIx(
    [voteAccount, validatorIdentity],
    ixCreate,
    ixInitialize,
  )
  return {
    voteAccount: voteAccount.publicKey,
    validatorIdentity,
    authorizedVoter,
    authorizedWithdrawer,
  }
}

export async function removeVoteAccount({
  provider,
  voteAccount,
  authorizedWithdrawer,
  toPubkey = authorizedWithdrawer.publicKey,
}: {
  provider: ExtendedProvider
  voteAccount: PublicKey
  authorizedWithdrawer: Keypair
  toPubkey?: PublicKey
}): Promise<{
  voteAccount: PublicKey
  authorizedWithdrawer: Keypair
  toPubkey: PublicKey
  lamports: number
}> {
  const voteAccountInfo = await provider.connection.getAccountInfo(voteAccount)
  const voteAccountData = getVoteAccountFromData(
    voteAccount,
    voteAccountInfo as AccountInfo<Buffer>,
  )
  const lamports = voteAccountData.account.lamports

  const ixWithdraw = VoteProgram.withdraw({
    votePubkey: voteAccount,
    authorizedWithdrawerPubkey: authorizedWithdrawer.publicKey,
    toPubkey,
    lamports,
  })

  await provider.sendIx([authorizedWithdrawer], ixWithdraw)
  return {
    voteAccount: voteAccount,
    authorizedWithdrawer,
    toPubkey,
    lamports,
  }
}

export async function authorizeStakeAccount({
  provider,
  stakeAccount,
  authority,
  staker,
  withdrawer,
  custodian,
}: {
  provider: ExtendedProvider
  stakeAccount: PublicKey
  authority: WalletInterface | Signer
  staker?: PublicKey
  withdrawer?: PublicKey
  custodian?: WalletInterface | Signer
}) {
  const ixes: Transaction[] = []
  if (staker) {
    const ix = StakeProgram.authorize({
      stakePubkey: stakeAccount,
      authorizedPubkey: authority.publicKey,
      newAuthorizedPubkey: staker,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
      custodianPubkey: custodian ? custodian.publicKey : undefined,
    })
    ixes.push(ix)
  }
  if (withdrawer) {
    const ix = StakeProgram.authorize({
      stakePubkey: stakeAccount,
      authorizedPubkey: authority.publicKey,
      newAuthorizedPubkey: withdrawer,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      custodianPubkey: custodian ? custodian.publicKey : undefined,
    })
    ixes.push(ix)
  }
  const signers = [authority]
  if (custodian) {
    signers.push(custodian)
  }
  await provider.sendIx(signers, ...ixes)
}

export type DelegatedStakeAccount = {
  stakeAccount: PublicKey
  voteAccount: PublicKey
  validatorIdentity: Keypair | undefined
  staker: Keypair
  withdrawer: Keypair
}

export async function delegatedStakeAccount({
  provider,
  voteAccountToDelegate,
  lockup,
  lamports,
  rentExemptVote,
  staker = Keypair.generate(),
  withdrawer = Keypair.generate(),
}: {
  provider: ExtendedProvider
  voteAccountToDelegate?: PublicKey
  lockup?: Lockup
  lamports?: number | BN
  rentExemptVote?: number
  staker?: Keypair
  withdrawer?: Keypair
}): Promise<DelegatedStakeAccount> {
  const stakeAccount = Keypair.generate()
  lamports = lamports ?? LAMPORTS_PER_SOL + (await getRentExemptStake(provider))

  let validatorIdentity: Keypair | undefined = undefined
  if (voteAccountToDelegate === undefined) {
    rentExemptVote =
      rentExemptVote ?? (await getRentExemptVote(provider, rentExemptVote))
    ;({ voteAccount: voteAccountToDelegate, validatorIdentity } =
      await createVoteAccount({ provider, rentExempt: rentExemptVote }))
  }

  const createStakeAccountIx = StakeProgram.createAccount({
    fromPubkey: provider.walletPubkey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(staker.publicKey, withdrawer.publicKey),
    lamports: new BN(lamports).toNumber(),
    lockup,
  })
  // error 0xc on 'Instruction 2' means not enough SOL to delegate the account
  // lamports param has to be rentExempt + 1 SOL in new Solana versions
  const delegateStakeAccountIx = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: staker.publicKey,
    votePubkey: voteAccountToDelegate,
  })
  await retryOnEpochRewardsPeriod(() =>
    provider.sendIx(
      [stakeAccount, staker],
      createStakeAccountIx,
      delegateStakeAccountIx,
    ),
  )

  return {
    stakeAccount: stakeAccount.publicKey,
    voteAccount: voteAccountToDelegate,
    validatorIdentity,
    staker,
    withdrawer,
  }
}

export async function createBondsFundedStakeAccount({
  program,
  provider,
  configAccount,
  lamports,
  voteAccount,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  lamports: number | BN
  voteAccount: PublicKey
}): Promise<PublicKey> {
  const [bondsAuth] = bondsWithdrawerAuthority(configAccount, program.programId)
  return await createDelegatedStakeAccount({
    provider,
    voteAccount,
    lamports,
    withdrawer: bondsAuth,
    staker: bondsAuth,
  })
}

export async function createSettlementFundedDelegatedStake({
  program,
  provider,
  configAccount,
  settlementAccount,
  voteAccount,
  lamports,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  settlementAccount: PublicKey
  voteAccount: PublicKey
  lamports: number
}): Promise<PublicKey> {
  const [bondsAuth] = bondsWithdrawerAuthority(configAccount, program.programId)
  const [settlementAuth] = settlementStakerAuthority(
    settlementAccount,
    program.programId,
  )
  return await createDelegatedStakeAccount({
    provider,
    voteAccount,
    lamports,
    withdrawer: bondsAuth,
    staker: settlementAuth,
  })
}

export async function createSettlementFundedInitializedStake({
  program,
  provider,
  configAccount,
  settlementAccount,
  lamports = LAMPORTS_PER_SOL,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  settlementAccount: PublicKey
  lamports?: number
}): Promise<PublicKey> {
  const [bondsAuth] = bondsWithdrawerAuthority(configAccount, program.programId)
  const [settlementAuth] = settlementStakerAuthority(
    settlementAccount,
    program.programId,
  )

  const { stakeAccount, withdrawer } = await createInitializedStakeAccount({
    provider,
    rentExempt: lamports,
  })
  await authorizeStakeAccount({
    provider,
    stakeAccount,
    withdrawer: bondsAuth,
    authority: signer(withdrawer),
    staker: settlementAuth,
  })

  return stakeAccount
}

export async function createDelegatedStakeAccount({
  provider,
  lamports,
  voteAccount,
  withdrawer,
  staker,
}: {
  provider: ExtendedProvider
  lamports: number | BN
  voteAccount: PublicKey
  withdrawer: PublicKey
  staker: PublicKey
}): Promise<PublicKey> {
  const { stakeAccount, withdrawer: initWithdrawer } =
    await delegatedStakeAccount({
      provider,
      lamports,
      voteAccountToDelegate: voteAccount,
    })
  while (true) {
    try {
      await authorizeStakeAccount({
        provider,
        authority: initWithdrawer,
        stakeAccount: stakeAccount,
        withdrawer,
        staker,
      })
    } catch (e) {
      if (isErrorEpochRewardsPeriod(e)) {
        continue
      } else {
        console.error(
          `Failed to authorize stake account ${stakeAccount.toBase58()}`,
          e,
        )
      }
    }
    break
  }
  return stakeAccount
}

export function isErrorEpochRewardsPeriod(e: unknown): boolean {
  let errMsg = (e as Error).message
  if (e instanceof ExecutionError) {
    errMsg = e.messageWithCause()
  }
  // 16 - Stake action is not permitted while the epoch rewards period is active
  // https://github.com/solana-program/stake/blob/a173d0ef0e1d0af08d3ec89444516483df880f37/clients/rust/src/generated/errors/stake.rs#L64
  if (
    errMsg.includes('custom program error: 0x10') ||
    errMsg.includes('"Custom":16')
  ) {
    return true
  }
  return false
}

// Retry execution when epoch rewards period is active (error 0x10, Custom: 16)
export async function retryOnEpochRewardsPeriod<T>(
  fn: () => Promise<T>,
): Promise<T> {
  while (true) {
    try {
      return await fn()
    } catch (e) {
      if (isErrorEpochRewardsPeriod(e)) {
        continue
      }
      throw e
    }
  }
}

export async function nonInitializedStakeAccount(
  provider: ExtendedProvider,
  rentExempt?: number,
): Promise<[PublicKey, Keypair]> {
  const accountKeypair = Keypair.generate()
  const createSystemAccountIx = SystemProgram.createAccount({
    fromPubkey: provider.walletPubkey,
    newAccountPubkey: accountKeypair.publicKey,
    lamports: await getRentExemptStake(provider, rentExempt),
    space: StakeProgram.space,
    programId: StakeProgram.programId,
  })
  await provider.sendIx([accountKeypair], createSystemAccountIx)
  return [accountKeypair.publicKey, accountKeypair]
}

export type InitializedStakeAccount = {
  stakeAccount: PublicKey
  staker: Keypair | PublicKey
  withdrawer: Keypair | PublicKey
}

export async function createInitializedStakeAccount({
  provider,
  lockup,
  rentExempt,
  staker = Keypair.generate(),
  withdrawer = Keypair.generate(),
}: {
  provider: ExtendedProvider
  lockup?: Lockup
  rentExempt?: number
  staker?: Keypair | PublicKey
  withdrawer?: Keypair | PublicKey
}): Promise<InitializedStakeAccount> {
  const stakeAccount = Keypair.generate()
  rentExempt = await getRentExemptStake(provider, rentExempt)

  const ix = StakeProgram.createAccount({
    fromPubkey: provider.walletPubkey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(pubkey(staker), pubkey(withdrawer)),
    lamports: rentExempt,
    lockup,
  })
  await retryOnEpochRewardsPeriod(() => provider.sendIx([stakeAccount], ix))
  console.log(`Stake ${stakeAccount.publicKey.toBase58()} account created`)
  return {
    stakeAccount: stakeAccount.publicKey,
    staker,
    withdrawer,
  }
}
