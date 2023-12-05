import {
  Authorized,
  Keypair,
  Lockup,
  PublicKey,
  StakeAuthorizationLayout,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
  Signer,
  AccountInfo,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../../src'
import { BankrunProvider } from 'anchor-bankrun'
import { bankrunExecuteIx, initBankrunTest } from './utils/bankrun'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { StakeProgram, VoteProgram } from '@solana/web3.js'
import { VOTE_ACCOUNT_SIZE, deserializeStakeState } from './utils/stakeState'
import assert from 'assert'
import { StakeState } from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import { Provider } from '@coral-xyz/anchor'

describe('Solana stake account behavior verification', () => {
  let provider: BankrunProvider
  let program: ValidatorBondsProgram
  let rentExemptStake: number
  let rentExemptVote: number

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider, program } = await initBankrunTest())
    rentExemptStake =
      await provider.connection.getMinimumBalanceForRentExemption(
        StakeProgram.space
      )
    rentExemptVote =
      await provider.connection.getMinimumBalanceForRentExemption(
        VOTE_ACCOUNT_SIZE
      )
  })

  // TODO: #1 when stake account is created with lockup what happens when authority is changed?
  //          will the lockup custodian stays the same as before?
  //          can be lockup removed completely?
  //          what the 'custodian' field on 'authorize' method has the significance for?
  //
  // TODO: #2 check what happens when lockup account is merged with non-lockup account?
  // TODO: #3 what happen after split of stake account with authorities, are they maintained as in the original one?

  it.skip('cannot merge uninitialized + merge initialized with correct meta', async () => {
    const [sourcePubkey] = await nonInitializedStakeAccount(
      provider,
      rentExemptStake
    )
    const [destPubkey] = await nonInitializedStakeAccount(
      provider,
      rentExemptStake
    )

    await checkStakeAccount(provider, sourcePubkey, StakeStates.Uninitialized)
    await checkStakeAccount(provider, destPubkey, StakeStates.Uninitialized)
    const mergeUninitializedTx = StakeProgram.merge({
      stakePubkey: destPubkey,
      sourceStakePubKey: sourcePubkey,
      authorizedPubkey: provider.wallet.publicKey,
    })
    // 1. CANNOT MERGE WHEN UNINITIALIZED
    await verifyErrorMessage(
      provider,
      '1.',
      'invalid account data for instruction',
      [provider.wallet],
      mergeUninitializedTx
    )

    const sourceStaker = Keypair.generate()
    const sourceWithdrawer = Keypair.generate()
    const destStaker = Keypair.generate()
    const destWithdrawer = Keypair.generate()
    const sourceInitIx = StakeProgram.initialize({
      stakePubkey: sourcePubkey,
      authorized: new Authorized(
        sourceStaker.publicKey,
        sourceWithdrawer.publicKey
      ),
      lockup: undefined,
    })
    const destInitIx = StakeProgram.initialize({
      stakePubkey: destPubkey,
      authorized: new Authorized(
        destStaker.publicKey,
        destWithdrawer.publicKey
      ),
      lockup: undefined,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet],
      sourceInitIx,
      destInitIx
    )

    await checkStakeAccount(provider, sourcePubkey, StakeStates.Initialized)
    await checkStakeAccount(provider, destPubkey, StakeStates.Initialized)

    const mergeInitializedWrongAuthorityTx = StakeProgram.merge({
      stakePubkey: destPubkey,
      sourceStakePubKey: sourcePubkey,
      authorizedPubkey: sourceStaker.publicKey,
    })
    // 2. CANNOT MERGE WHEN HAVING DIFFERENT STAKER AUTHORITIES
    await verifyErrorMessage(
      provider,
      '2.',
      'missing required signature for instruction',
      [provider.wallet, sourceStaker],
      mergeInitializedWrongAuthorityTx
    )

    // staker authority change is ok to be signed by staker
    const changeStakerAuthIx = StakeProgram.authorize({
      stakePubkey: destPubkey,
      authorizedPubkey: destStaker.publicKey,
      newAuthorizedPubkey: sourceStaker.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
      custodianPubkey: undefined,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, destStaker],
      changeStakerAuthIx
    )

    // pushing clock forward to get new latest blockhash from the client
    provider.context.warpToSlot(
      (await provider.context.banksClient.getClock()).slot + BigInt(1)
    )

    const mergeInitializedWrongWithdrawAuthorityTx = StakeProgram.merge({
      stakePubkey: destPubkey,
      sourceStakePubKey: sourcePubkey,
      authorizedPubkey: sourceStaker.publicKey,
    })
    // 3. CANNOT MERGE WHEN HAVING DIFFERENT WITHDRAWER AUTHORITIES
    // https://github.com/solana-labs/solana/blob/v1.17.7/programs/stake/src/stake_state.rs#L1392
    await verifyErrorMessage(
      provider,
      '3.',
      'custom program error: 0x6',
      [provider.wallet, sourceStaker],
      mergeInitializedWrongWithdrawAuthorityTx
    )

    const changeWithdrawerAuthIx = StakeProgram.authorize({
      stakePubkey: destPubkey,
      authorizedPubkey: destWithdrawer.publicKey,
      newAuthorizedPubkey: sourceWithdrawer.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      custodianPubkey: undefined,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, destWithdrawer],
      changeWithdrawerAuthIx
    )

    // pushing clock forward to get new latest blockhash from the client
    provider.context.warpToSlot(
      (await provider.context.banksClient.getClock()).slot + BigInt(1)
    )

    // 4. FINAL SUCCESSFUL MERGE
    const mergeTx = StakeProgram.merge({
      stakePubkey: destPubkey,
      sourceStakePubKey: sourcePubkey,
      authorizedPubkey: sourceStaker.publicKey,
    })
    await bankrunExecuteIx(provider, [provider.wallet, sourceStaker], mergeTx)
  })

  it.skip('merge stake account with expired lockup', async () => {
    const { epoch } = await provider.context.banksClient.getClock()
    const staker = Keypair.generate()
    const stakeAccount1Epoch = Number(epoch) - 1
    const { stakeAccount: stakeAccount1, withdrawer } =
      await initializedStakeAccount(
        provider,
        new Lockup(0, stakeAccount1Epoch, PublicKey.default),
        rentExemptStake,
        staker.publicKey
      )
    const { stakeAccount: stakeAccount2 } = await initializedStakeAccount(
      provider,
      new Lockup(0, Number(epoch) - 2, PublicKey.default),
      rentExemptStake,
      staker.publicKey,
      withdrawer
    )
    const mergeTx = StakeProgram.merge({
      stakePubkey: stakeAccount2,
      sourceStakePubKey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
    })
    // 1. CANNOT MERGE EVEN WHEN LOCKUP IS OVER WHEN Lockup data is different
    await verifyErrorMessage(
      provider,
      '1.',
      'custom program error: 0x6',
      [provider.wallet, staker],
      mergeTx
    )

    const { stakeAccount: stakeAccount3 } = await initializedStakeAccount(
      provider,
      new Lockup(0, stakeAccount1Epoch, Keypair.generate().publicKey),
      rentExemptStake,
      staker.publicKey,
      withdrawer
    )
    const mergeTx3 = StakeProgram.merge({
      stakePubkey: stakeAccount3,
      sourceStakePubKey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
    })
    // 2. CANNOT MERGE EVEN WHEN LOCKUP IS OVER WHEN Lockup custodians are different
    await verifyErrorMessage(
      provider,
      '2.',
      'custom program error: 0x6',
      [provider.wallet, staker],
      mergeTx3
    )

    const { stakeAccount: stakeAccount4 } = await initializedStakeAccount(
      provider,
      new Lockup(0, stakeAccount1Epoch, PublicKey.default),
      rentExemptStake,
      staker.publicKey,
      withdrawer
    )
    // stakeAccount1 --> merged to --> stakeAccount4
    const mergeTx4 = StakeProgram.merge({
      stakePubkey: stakeAccount4,
      sourceStakePubKey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
    })
    // 3. LOCKUP cannot be changed after creation, only merge accounts with the same lockup
    await bankrunExecuteIx(provider, [provider.wallet, staker], mergeTx4)
    // merged, account is gone
    expect(
      provider.context.banksClient.getAccount(stakeAccount1)
    ).resolves.toBeNull()

    // 4. AUTHORIZE to new staker, lockup is over, not necessary to use custodian
    let stakeAccount1Data = await checkStakeAccount(
      provider,
      stakeAccount4,
      StakeStates.Initialized
    )
    expect(stakeAccount1Data.Initialized?.meta.authorized.staker).toEqual(
      staker.publicKey
    )
    const newStaker = Keypair.generate()
    const changeStakerAuthIx = StakeProgram.authorize({
      stakePubkey: stakeAccount4,
      authorizedPubkey: staker.publicKey,
      newAuthorizedPubkey: newStaker.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
      // using random non-existent custodian here
      custodianPubkey: Keypair.generate().publicKey,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, staker],
      changeStakerAuthIx
    )
    stakeAccount1Data = await checkStakeAccount(
      provider,
      stakeAccount4,
      StakeStates.Initialized
    )
    expect(stakeAccount1Data.Initialized?.meta.authorized.staker).toEqual(
      newStaker.publicKey
    )
  })

  it('merge stake account with running lockup', async () => {
    const { unixTimestamp } = await provider.context.banksClient.getClock()
    const staker = Keypair.generate()
    const withdrawer = Keypair.generate()
    const custodian = Keypair.generate()
    const lockup = new Lockup(Number(unixTimestamp) + 1000, 0, custodian.publicKey)
    const { stakeAccount: stakeAccount1 } =
      await initializedStakeAccount(
        provider,
        lockup,
        rentExemptStake,
        staker.publicKey,
        withdrawer.publicKey
      )
    const { stakeAccount: stakeAccount2 } = await initializedStakeAccount(
      provider,
      lockup,
      rentExemptStake,
      staker.publicKey,
      withdrawer.publicKey
    )

    // 1. AUTHORIZE POSSIBLE WHEN LOCKUP IS RUNNING AND META IS THE SAME
    const newStaker = Keypair.generate()
    const changeStakerAuthIx = StakeProgram.authorize({
      stakePubkey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
      newAuthorizedPubkey: newStaker.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
    })
    const changeStakerAuthIx2 = StakeProgram.authorize({
      stakePubkey: stakeAccount2,
      authorizedPubkey: staker.publicKey,
      newAuthorizedPubkey: newStaker.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, staker],
      changeStakerAuthIx, changeStakerAuthIx2
    )

    // stakeAccount2 --> merged to --> stakeAccount1
    const mergeTx = StakeProgram.merge({
      stakePubkey: stakeAccount1,
      sourceStakePubKey: stakeAccount2,
      authorizedPubkey: newStaker.publicKey,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, newStaker],
      mergeTx
    )

    // creating vote account to delegate to it
    const {voteAccount} = await createVoteAccount(provider, rentExemptVote)
    const delegateIx = StakeProgram.delegate({
      stakePubkey: stakeAccount1,
      authorizedPubkey: newStaker.publicKey,
      votePubkey: voteAccount,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, newStaker],
      delegateIx
    )
  })

  it.skip('merge delegated stake account', async () => {
    const { voteAccount } = await createVoteAccount(provider, rentExemptVote)
    // TODO: ...
  })
})

type VoteAccountKeys = {
  voteAccount: PublicKey
  nodeIdentity: Keypair
  authorizedVoter: Keypair
  authorizedWithdrawer: Keypair
}

async function createVoteAccount(
  provider: BankrunProvider,
  rentExempt: number
): Promise<VoteAccountKeys> {
  rentExempt =
    rentExempt ||
    (await provider.connection.getMinimumBalanceForRentExemption(
      VOTE_ACCOUNT_SIZE
    ))

  const voteAccount = Keypair.generate()
  const nodeIdentity = Keypair.generate()
  const authorizedVoter = Keypair.generate()
  const authorizedWithdrawer = Keypair.generate()

  const ixCreate = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    newAccountPubkey: voteAccount.publicKey,
    lamports: rentExempt,
    space: VOTE_ACCOUNT_SIZE,
    programId: VoteProgram.programId,
  })
  const ixInitialize = VoteProgram.initializeAccount({
    votePubkey: voteAccount.publicKey,
    nodePubkey: nodeIdentity.publicKey,
    voteInit: {
      authorizedVoter: authorizedVoter.publicKey,
      authorizedWithdrawer: authorizedWithdrawer.publicKey,
      commission: 0,
      nodePubkey: nodeIdentity.publicKey,
    },
  })

  await bankrunExecuteIx(
    provider,
    [provider.wallet, voteAccount, nodeIdentity],
    ixCreate,
    ixInitialize
  )
  return {
    voteAccount: voteAccount.publicKey,
    nodeIdentity,
    authorizedVoter,
    authorizedWithdrawer,
  }
}

function checkErrorMessage(e: unknown, message: string) {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof e.message === 'string' &&
    e.message.includes(message)
  )
}

async function verifyErrorMessage(
  provider: BankrunProvider,
  info: string,
  checkMessage: string,
  signers: (WalletInterface | Signer)[],
  ...ixes: (
    | Transaction
    | TransactionInstruction
    | TransactionInstructionCtorFields
  )[]
) {
  try {
    await bankrunExecuteIx(provider, signers, ...ixes)
    throw new Error(`Expected failure ${info}`)
  } catch (e) {
    if (checkErrorMessage(e, checkMessage)) {
      console.debug(`${info} expected error`, e)
    } else {
      console.error(`${info} not expected error despite a failure expected`, e)
      throw e
    }
  }
}

export enum StakeStates {
  Uninitialized,
  Initialized,
  Delegated,
  RewardsPool,
}

async function checkStakeAccount(
  provider: Provider,
  account: PublicKey,
  stakeStateCheck: StakeStates
): Promise<StakeState> {
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
  return stakeData
}

async function nonInitializedStakeAccount(
  provider: BankrunProvider,
  rentExempt?: number
): Promise<[PublicKey, Keypair]> {
  const accountKeypair = Keypair.generate()
  const createSystemAccountIx = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    newAccountPubkey: accountKeypair.publicKey,
    lamports: await getRentExempt(provider, rentExempt),
    space: StakeProgram.space,
    programId: StakeProgram.programId,
  })
  await bankrunExecuteIx(
    provider,
    [accountKeypair, provider.wallet],
    createSystemAccountIx
  )
  return [accountKeypair.publicKey, accountKeypair]
}

type InitializedStakeAccount = {
  stakeAccount: PublicKey
  staker: PublicKey
  withdrawer: PublicKey
}

async function initializedStakeAccount(
  provider: BankrunProvider,
  lockup?: Lockup,
  rentExempt?: number,
  staker: PublicKey = Keypair.generate().publicKey,
  withdrawer: PublicKey = Keypair.generate().publicKey
): Promise<InitializedStakeAccount> {
  const stakeAccount = Keypair.generate()
  rentExempt = await getRentExempt(provider, rentExempt)

  const ix = StakeProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(staker, withdrawer),
    lamports: rentExempt,
    lockup,
  })
  await bankrunExecuteIx(provider, [provider.wallet, stakeAccount], ix)
  return {
    stakeAccount: stakeAccount.publicKey,
    staker,
    withdrawer,
  }
}

async function getRentExempt(
  provider: BankrunProvider,
  rentExempt?: number
): Promise<number> {
  return (
    rentExempt ||
    (await provider.connection.getMinimumBalanceForRentExemption(
      StakeProgram.space
    ))
  )
}
