import {
  Authorized,
  Keypair,
  PublicKey,
  StakeAuthorizationLayout,
  SystemProgram,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../../src'
import { Clock } from 'solana-bankrun'
import { BankrunProvider } from 'anchor-bankrun'
import {
  bankrunExecute,
  bankrunExecuteIx,
  bankrunTransaction,
  initBankrunTest,
} from './utils/bankrun'
import { StakeProgram } from '@solana/web3.js'
import { deserializeStakeState } from './utils/stakeState'
import assert from 'assert'
import { StakeState } from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import { Provider } from '@coral-xyz/anchor'

describe('Solana stake account behavior verification', () => {
  let provider: BankrunProvider
  let program: ValidatorBondsProgram
  let rentExempt: number

  const keypairCreator = Keypair.generate()
  const staker = Keypair.generate()
  const withdrawer = Keypair.generate()

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider, program } = await initBankrunTest())
    rentExempt = await provider.connection.getMinimumBalanceForRentExemption(
      StakeProgram.space
    )
  })

  // TODO: #1 when stake account is created with lockup what happens when authority is changed?
  //          will the lockup custodian stays the same as before?
  //          can be lockup removed completely?
  //          what the 'custodian' field on 'authorize' method has the significance for?
  //
  // TODO: #2 check what happens when lockup account is merged with non-lockup account?
  // TODO: #3 what happen after split of stake account with authorities, are they maintained as in the original one?
  it.skip('Create stake account', async () => {
    const sourceStake = await nonDelegatedStakeAccount(provider)
    const destStake = await nonDelegatedStakeAccount(provider, staker.publicKey)
    const mergeIx = StakeProgram.merge({
      stakePubkey: destStake,
      sourceStakePubKey: sourceStake,
      authorizedPubkey: staker.publicKey,
    })
    const tx = await bankrunTransaction(provider)
    tx.add(mergeIx)
    await bankrunExecute(provider, [provider.wallet, keypairCreator], tx)
  })

  it.skip('Create and init stake account', async () => {
    const accountKeypair = Keypair.generate()
    const authority = Keypair.generate().publicKey
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        StakeProgram.space
      )
    const createSystemAccountIx = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: accountKeypair.publicKey,
      lamports: rentExempt,
      space: StakeProgram.space,
      programId: StakeProgram.programId,
    })
    const initializeIx = StakeProgram.initialize({
      stakePubkey: accountKeypair.publicKey,
      authorized: new Authorized(authority, authority),
      lockup: undefined,
    })
    const tx = await bankrunTransaction(provider)
    tx.add(createSystemAccountIx, initializeIx)
    await bankrunExecute(provider, [provider.wallet, accountKeypair], tx)

    const ai = await provider.connection.getAccountInfo(
      accountKeypair.publicKey
    )
    expect(ai).toBeDefined()
    assert(ai)
    const stakeData = deserializeStakeState(ai.data)
    console.log(stakeData)
    expect(stakeData.Uninitialized).toBeDefined()
  })

  it('Cannot merge uninitialized, merge initialized', async () => {
    const [sourcePubkey] = await nonInitializedStakeAccount(
      provider,
      rentExempt
    )
    const [destPubkey] = await nonInitializedStakeAccount(provider, rentExempt)

    await checkStakeAccount(provider, sourcePubkey, StakeStates.Uninitialized)
    await checkStakeAccount(provider, destPubkey, StakeStates.Uninitialized)
    const mergeUninitializedTx = StakeProgram.merge({
      stakePubkey: destPubkey,
      sourceStakePubKey: sourcePubkey,
      authorizedPubkey: provider.wallet.publicKey,
    })
    // 1. CANNOT MERGE WHEN UNINITIALIZED
    try {
      await bankrunExecuteIx(
        provider,
        [provider.wallet],
        [mergeUninitializedTx]
      )
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
      [sourceInitIx, destInitIx]
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
        [mergeInitializedWrongAuthorityTx]
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
      [changeStakerAuthIx]
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
        [mergeInitializedWrongWithdrawAuthorityTx]
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
  })
})

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
    [createSystemAccountIx]
  )
  return [accountKeypair.publicKey, accountKeypair]
}

async function nonDelegatedStakeAccount(
  provider: BankrunProvider,
  staker?: PublicKey,
  withdrawer?: PublicKey
): Promise<PublicKey> {
  const stakeKeypair = Keypair.generate()
  staker = staker || Keypair.generate().publicKey
  withdrawer = withdrawer || Keypair.generate().publicKey
  const rentExempt =
    await provider.connection.getMinimumBalanceForRentExemption(
      StakeProgram.space
    )
  const ix = StakeProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    stakePubkey: stakeKeypair.publicKey,
    authorized: new Authorized(staker, withdrawer),
    lamports: rentExempt,
  })
  const tx = await bankrunTransaction(provider)
  tx.add(ix)
  await bankrunExecute(provider, [provider.wallet, stakeKeypair], tx)
  return stakeKeypair.publicKey
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
