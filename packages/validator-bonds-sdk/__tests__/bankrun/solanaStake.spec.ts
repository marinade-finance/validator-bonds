import {
  Authorized,
  Keypair,
  Lockup,
  PublicKey,
  StakeAuthorizationLayout,
  SystemProgram,
  VoteInit,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../../src'
import { BankrunProvider } from 'anchor-bankrun'
import {
  bankrunExecute,
  bankrunExecuteIx,
  bankrunTransaction,
  initBankrunTest,
} from './utils/bankrun'
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
    try {
      await bankrunExecuteIx(provider, [provider.wallet], mergeUninitializedTx)
      throw new Error('Expected failure 1.')
    } catch (e) {
      if (checkErrorMessage(e, 'invalid account data for instruction')) {
        console.debug('1. expected error', e)
      } else {
        console.error('Not expected error despite a failure expected', e)
        throw e
      }
    }

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
    try {
      await bankrunExecuteIx(
        provider,
        [provider.wallet, sourceStaker],
        mergeInitializedWrongAuthorityTx
      )
      throw new Error('Expected failure 2.')
    } catch (e) {
      if (checkErrorMessage(e, 'missing required signature for instruction')) {
        console.debug('2. expected error', e)
      } else {
        console.error('Not expected error despite a failure expected', e)
        throw e
      }
    }

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
    try {
      await bankrunExecuteIx(
        provider,
        [provider.wallet, sourceStaker],
        mergeInitializedWrongWithdrawAuthorityTx
      )
      throw new Error('Expected failure 3.')
    } catch (e) {
      if (checkErrorMessage(e, 'custom program error: 0x6')) {
        console.debug('3. expected error', e)
      } else {
        console.error('Not expected error despite a failure expected', e)
        throw e
      }
    }

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

  it('merge stake account with lockup', async () => {
    const stakeAccount = await initializedStakeAccount(provider, new Lockup(0, 0, provider.wallet.publicKey), rentExemptStake)
    
  })

  it.skip('merge delegated stake account', async () => {
    const {voteAccount} = await createVoteAccount(provider, rentExemptVote)
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
  const accountInfo = await provider.connection.getAccountInfo(account)
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

async function initializedStakeAccount(
  provider: BankrunProvider,
  lockup?: Lockup,
  rentExempt?: number
): Promise<PublicKey> {
  const stakeAccount = Keypair.generate()
  const staker = Keypair.generate().publicKey
  const withdrawer = Keypair.generate().publicKey
  rentExempt = await getRentExempt(provider, rentExempt)

  const ix = StakeProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(staker, withdrawer),
    lamports: rentExempt,
    lockup,
  })
  await bankrunExecuteIx(provider, [provider.wallet, stakeAccount], ix)
  return stakeAccount.publicKey
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
