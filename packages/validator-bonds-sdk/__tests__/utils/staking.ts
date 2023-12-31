import { deserializeUnchecked } from 'borsh'
import { Provider } from '@coral-xyz/anchor'
import {
  AccountInfo,
  Authorized,
  Keypair,
  Lockup,
  PublicKey,
  StakeProgram,
  SystemProgram,
  VoteProgram,
  TransactionInstruction,
  Transaction,
  StakeAuthorizationLayout,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import { ExtendedProvider } from './provider'
import {
  StakeState,
  STAKE_STATE_BORSH_SCHEMA,
} from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import assert from 'assert'
import { pubkey } from './helpers'

// Depending if new vote account feature-set is gated on.
// It can be 3762 or 3736
// https://github.com/solana-labs/solana-web3.js/blob/v1.87.6/packages/library-legacy/src/programs/vote.ts#L372
// It may emit error:
//  Failed to process transaction: transport transaction error: Error processing Instruction 1: invalid account data for instruction
export const VOTE_ACCOUNT_SIZE = 3762

// borrowed from https://github.com/marinade-finance/marinade-ts-sdk/blob/v5.0.6/src/marinade-state/marinade-state.ts#L234
export function deserializeStakeState(data: Buffer): StakeState {
  // The data's first 4 bytes are: u8 0x0 0x0 0x0 but borsh uses only the first byte to find the enum's value index.
  // The next 3 bytes are unused and we need to get rid of them (or somehow fix the BORSH schema?)
  const adjustedData = Buffer.concat([
    data.subarray(0, 1), // the first byte indexing the enum
    data.subarray(4, data.length), // the first byte indexing the enum
  ])
  return deserializeUnchecked(
    STAKE_STATE_BORSH_SCHEMA,
    StakeState,
    adjustedData
  )
}

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
  params: SetLockupStakeParams
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

export async function getRentExemptVote(
  provider: Provider,
  rentExempt?: number
): Promise<number> {
  return (
    rentExempt ||
    (await provider.connection.getMinimumBalanceForRentExemption(
      VOTE_ACCOUNT_SIZE
    ))
  )
}

export async function getRentExemptStake(
  provider: Provider,
  rentExempt?: number
): Promise<number> {
  return (
    rentExempt ||
    (await provider.connection.getMinimumBalanceForRentExemption(
      StakeProgram.space
    ))
  )
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
  stakeStateCheck?: StakeStates
): Promise<[StakeState, AccountInfo<Buffer>]> {
  let accountInfo: AccountInfo<Buffer>
  try {
    accountInfo = (await provider.connection.getAccountInfo(
      account
    )) as AccountInfo<Buffer>
  } catch (e) {
    console.error(e)
    throw new Error(`Account ${account.toBase58()} does not exist on chain`)
  }
  expect(accountInfo).toBeDefined()
  assert(accountInfo)
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
  validatorIdentity: Keypair
): Promise<VoteAccountKeys> {
  return await createVoteAccount(
    provider,
    undefined,
    undefined,
    undefined,
    validatorIdentity
  )
}

export async function createVoteAccount(
  provider: ExtendedProvider,
  rentExempt?: number,
  authorizedVoter?: Keypair,
  authorizedWithdrawer?: Keypair,
  validatorIdentity?: Keypair
): Promise<VoteAccountKeys> {
  rentExempt = await getRentExemptVote(provider, rentExempt)

  const voteAccount = Keypair.generate()
  validatorIdentity = validatorIdentity || Keypair.generate()
  authorizedVoter = authorizedVoter || Keypair.generate()
  authorizedWithdrawer = authorizedWithdrawer || Keypair.generate()

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
    ixInitialize
  )
  return {
    voteAccount: voteAccount.publicKey,
    validatorIdentity,
    authorizedVoter,
    authorizedWithdrawer,
  }
}

export async function authorizeStakeAccount({
  provider,
  stakeAccount,
  authority,
  staker,
  withdrawer,
}: {
  provider: ExtendedProvider
  stakeAccount: PublicKey
  authority: Keypair
  staker?: PublicKey
  withdrawer?: PublicKey
}) {
  const ixes: Transaction[] = []
  if (staker) {
    const ix = StakeProgram.authorize({
      stakePubkey: stakeAccount,
      authorizedPubkey: authority.publicKey,
      newAuthorizedPubkey: staker,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
      custodianPubkey: undefined,
    })
    ixes.push(ix)
  }
  if (withdrawer) {
    const ix = StakeProgram.authorize({
      stakePubkey: stakeAccount,
      authorizedPubkey: authority.publicKey,
      newAuthorizedPubkey: withdrawer,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      custodianPubkey: undefined,
    })
    ixes.push(ix)
  }
  await provider.sendIx([authority], ...ixes)
}

type DelegatedStakeAccount = {
  stakeAccount: PublicKey
  voteAccount: PublicKey
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
  lamports?: number
  rentExemptVote?: number
  staker?: Keypair
  withdrawer?: Keypair
}): Promise<DelegatedStakeAccount> {
  const stakeAccount = Keypair.generate()
  lamports = lamports || LAMPORTS_PER_SOL + 1
  rentExemptVote = await getRentExemptVote(provider, rentExemptVote)

  voteAccountToDelegate =
    voteAccountToDelegate ||
    (await createVoteAccount(provider, rentExemptVote)).voteAccount

  const createStakeAccountIx = StakeProgram.createAccount({
    fromPubkey: provider.walletPubkey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(staker.publicKey, withdrawer.publicKey),
    lamports,
    lockup,
  })
  // error 0xc on 'Instruction 2' means not enough SOL to delegate the account
  // lamports param has to be rentExempt + 1 SOL in new Solana versions
  const delegateStakeAccountIx = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: staker.publicKey,
    votePubkey: voteAccountToDelegate,
  })
  await provider.sendIx(
    [stakeAccount, staker],
    createStakeAccountIx,
    delegateStakeAccountIx
  )

  return {
    stakeAccount: stakeAccount.publicKey,
    voteAccount: voteAccountToDelegate,
    staker,
    withdrawer,
  }
}

export async function nonInitializedStakeAccount(
  provider: ExtendedProvider,
  rentExempt?: number
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

type InitializedStakeAccount = {
  stakeAccount: PublicKey
  staker: Keypair | PublicKey
  withdrawer: Keypair | PublicKey
}

export async function initializedStakeAccount(
  provider: ExtendedProvider,
  lockup?: Lockup,
  rentExempt?: number,
  staker: Keypair | PublicKey = Keypair.generate(),
  withdrawer: Keypair | PublicKey = Keypair.generate()
): Promise<InitializedStakeAccount> {
  const stakeAccount = Keypair.generate()
  rentExempt = await getRentExemptStake(provider, rentExempt)

  const ix = StakeProgram.createAccount({
    fromPubkey: provider.walletPubkey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(pubkey(staker), pubkey(withdrawer)),
    lamports: rentExempt,
    lockup,
  })
  await provider.sendIx([stakeAccount], ix)
  return {
    stakeAccount: stakeAccount.publicKey,
    staker,
    withdrawer,
  }
}
