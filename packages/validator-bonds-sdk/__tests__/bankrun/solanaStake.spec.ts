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
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../../src'
import { BankrunProvider } from 'anchor-bankrun'
import { Clock } from 'solana-bankrun'
import { bankrunExecuteIx, initBankrunTest, warpToEpoch } from './utils/bankrun'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { StakeProgram, VoteProgram } from '@solana/web3.js'
import {
  VOTE_ACCOUNT_SIZE,
  deserializeStakeState,
  setLockup,
} from '../utils/stakeState'
import assert from 'assert'
import { StakeState } from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import { Provider } from '@coral-xyz/anchor'

describe('Solana stake account behavior verification', () => {
  let provider: BankrunProvider
  let rentExemptStake: number
  let rentExemptVote: number
  const startUpEpoch = 42

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider } = await initBankrunTest())
    rentExemptStake = await getRentExemptStake(provider)
    rentExemptVote = await getRentExemptVote(provider)
    warpToEpoch(provider, startUpEpoch)
  })

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

    await getAndCheckStakeAccount(
      provider,
      sourcePubkey,
      StakeStates.Uninitialized
    )
    await getAndCheckStakeAccount(
      provider,
      destPubkey,
      StakeStates.Uninitialized
    )
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

    await getAndCheckStakeAccount(
      provider,
      sourcePubkey,
      StakeStates.Initialized
    )
    await getAndCheckStakeAccount(provider, destPubkey, StakeStates.Initialized)

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

  /**
   * Can be lockup removed completely?
   *  - no, it seems the only way to change the lockup is to run SetLockup that configures but not removes it
   *    - when lockup is active the only way to change it is to use the custodian signature
   *    - when lockup is not active the only way to change it is to use the withdrawer signature
   * 
   * When calling authorize with custodianPubkey, the lockup is not changed
   *   - when lockup is active, the custodian signature is required, custodianPubkey is a way to pass the lockup custodian to ix
   */
  it.skip('merging stake account with different lockup metadata', async () => {
    const { epoch } = await provider.context.banksClient.getClock()
    const staker = Keypair.generate()
    const withdrawer = Keypair.generate()
    const stakeAccount1Epoch = Number(epoch) + 20
    const { stakeAccount: stakeAccount1 } = await initializedStakeAccount(
      provider,
      new Lockup(0, stakeAccount1Epoch, PublicKey.default),
      rentExemptStake,
      staker.publicKey,
      withdrawer.publicKey
    )
    const custodian2 = Keypair.generate()
    const { stakeAccount: stakeAccount2 } = await initializedStakeAccount(
      provider,
      new Lockup(0, -1, custodian2.publicKey), // max possible epoch lockup
      rentExemptStake,
      staker.publicKey,
      withdrawer.publicKey
    )
    const mergeTx = StakeProgram.merge({
      stakePubkey: stakeAccount2,
      sourceStakePubKey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
    })
    console.log(
      '1. CANNOT MERGE when active LOCKUP when meta data is different'
    )
    await verifyErrorMessage(
      provider,
      '1.',
      'custom program error: 0x6',
      [provider.wallet, staker],
      mergeTx
    )

    // we can change lockup data to match with custodian
    const setLockupIx = setLockup({
      stakePubkey: stakeAccount2,
      authorizedPubkey: custodian2.publicKey,
      epoch: stakeAccount1Epoch,
    })
    await bankrunExecuteIx(provider, [provider.wallet, custodian2], setLockupIx)

    provider.context.warpToSlot(
      (await provider.context.banksClient.getClock()).slot + BigInt(1)
    )
    const mergeTx2 = StakeProgram.merge({
      stakePubkey: stakeAccount2,
      sourceStakePubKey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
    })
    console.log(
      '2. CANNOT MERGE EVEN WHEN active LOCKUP WHEN Lockup custodians are different'
    )
    await verifyErrorMessage(
      provider,
      '2.',
      'custom program error: 0x6', // MergeMismatch
      [provider.wallet, staker],
      mergeTx2
    )

    // we can change lockup data to match the stake account 1
    const setLockupIx2 = setLockup({
      stakePubkey: stakeAccount2,
      authorizedPubkey: custodian2.publicKey,
      custodian: PublicKey.default,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, custodian2],
      setLockupIx2
    )

    // merging stakeAccount1 --> stakeAccount2
    provider.context.warpToSlot(
      (await provider.context.banksClient.getClock()).slot + BigInt(1)
    )
    const mergeTx3 = StakeProgram.merge({
      stakePubkey: stakeAccount2,
      sourceStakePubKey: stakeAccount1,
      authorizedPubkey: staker.publicKey,
    })
    console.log(
      '3. for active LOCKUP MERGING with the same LOCKUP metadata is permitted'
    )
    await bankrunExecuteIx(provider, [provider.wallet, staker], mergeTx3)
    // merged, stakeAccount1 is gone
    await assertNotExist(provider, stakeAccount1)

    console.log(
      '4. AUTHORIZE to new staker, lockup is over, not necessary to use custodian'
    )
    let [stakeAccount2Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount2,
      StakeStates.Initialized
    )
    expect(stakeAccount2Data.Initialized?.meta.authorized.staker).toEqual(
      staker.publicKey
    )
    const newStaker = Keypair.generate()
    const changeStakerAuthIx = StakeProgram.authorize({
      stakePubkey: stakeAccount2,
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
    ;[stakeAccount2Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount2,
      StakeStates.Initialized
    )
    expect(stakeAccount2Data.Initialized?.meta.authorized.staker).toEqual(
      newStaker.publicKey
    )

    console.log(
      '5. MERGE of inactive LOCKUP to active lockup is not possible without custodian'
    )
    const { stakeAccount: stakeAccountInactive } =
      await initializedStakeAccount(
        provider,
        new Lockup(0, 0, PublicKey.default),
        rentExemptStake,
        staker.publicKey,
        withdrawer.publicKey
      )
    // merging stakeAccountInactive -> stakeAccount2
    const mergeTxInactive = StakeProgram.merge({
      stakePubkey: stakeAccount2,
      sourceStakePubKey: stakeAccountInactive,
      authorizedPubkey: staker.publicKey,
    })
    await verifyErrorMessage(
      provider,
      '5.',
      'missing required signature for instruction',
      [provider.wallet, staker],
      mergeTxInactive
    )
  })

  it.skip('merge stake account with running lockup', async () => {
    const clock = await provider.context.banksClient.getClock()
    const staker = Keypair.generate()
    const withdrawer = Keypair.generate()
    const custodianWallet = provider.wallet
    const unixTimestampLockup = Number(clock.unixTimestamp) + 1000
    const lockup = new Lockup(unixTimestampLockup, 0, custodianWallet.publicKey)
    const { stakeAccount: stakeAccount1 } = await initializedStakeAccount(
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

    console.log('1. AUTHORIZE STAKER is possible when lockup is running')
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
      changeStakerAuthIx,
      changeStakerAuthIx2
    )

    console.log(
      '2. AUTHORIZE WITHDRAWER with LOCKUP being active only possible with custodian signature'
    )
    const newWithdrawer = Keypair.generate()
    const changeWithdrawerNoCustodianIx = StakeProgram.authorize({
      stakePubkey: stakeAccount1,
      authorizedPubkey: withdrawer.publicKey,
      newAuthorizedPubkey: newWithdrawer.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      custodianPubkey: undefined,
    })
    await verifyErrorMessage(
      provider,
      '2.',
      'custom program error: 0x7', // CustodianMissing
      [provider.wallet, withdrawer],
      changeWithdrawerNoCustodianIx
    )
    const changeWithdrawer1Ix = StakeProgram.authorize({
      stakePubkey: stakeAccount1,
      authorizedPubkey: withdrawer.publicKey,
      newAuthorizedPubkey: newWithdrawer.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      custodianPubkey: custodianWallet.publicKey,
    })
    const changeWithdrawer2Ix = StakeProgram.authorize({
      stakePubkey: stakeAccount2,
      authorizedPubkey: withdrawer.publicKey,
      newAuthorizedPubkey: newWithdrawer.publicKey,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      custodianPubkey: custodianWallet.publicKey,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, withdrawer, custodianWallet],
      changeWithdrawer1Ix,
      changeWithdrawer2Ix
    )

    // stakeAccount2 --> merged to --> stakeAccount1
    const mergeTx = StakeProgram.merge({
      stakePubkey: stakeAccount1,
      sourceStakePubKey: stakeAccount2,
      authorizedPubkey: newStaker.publicKey,
    })
    await bankrunExecuteIx(provider, [provider.wallet, newStaker], mergeTx)
    await assertNotExist(provider, stakeAccount2)
    await getAndCheckStakeAccount(
      provider,
      stakeAccount1,
      StakeStates.Initialized
    )

    // transferring some SOLs to have enough for delegation
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: stakeAccount1,
      lamports: LAMPORTS_PER_SOL * 10,
    })
    await bankrunExecuteIx(provider, [provider.wallet], transferIx)

    // creating vote account to delegate to it
    const { voteAccount } = await createVoteAccount(provider, rentExemptVote)
    const delegateIx = StakeProgram.delegate({
      stakePubkey: stakeAccount1,
      authorizedPubkey: newStaker.publicKey,
      votePubkey: voteAccount,
    })
    await bankrunExecuteIx(provider, [provider.wallet, newStaker], delegateIx)
    await getAndCheckStakeAccount(
      provider,
      stakeAccount1,
      StakeStates.Delegated
    )

    const deactivateIx = StakeProgram.deactivate({
      stakePubkey: stakeAccount1,
      authorizedPubkey: newStaker.publicKey,
    })
    await bankrunExecuteIx(provider, [provider.wallet, newStaker], deactivateIx)

    console.log('3. CANNOT withdraw when lockup is active')
    const withdrawIx = StakeProgram.withdraw({
      stakePubkey: stakeAccount1,
      authorizedPubkey: newWithdrawer.publicKey,
      toPubkey: provider.wallet.publicKey,
      lamports: LAMPORTS_PER_SOL * 5,
    })
    await verifyErrorMessage(
      provider,
      '3.',
      'custom program error: 0x1', // LockupInForce
      [provider.wallet, newWithdrawer],
      withdrawIx
    )

    console.log(
      '4. WE CAN withdraw when withdrawer AND custodian sign when lockup is active'
    )
    const withdrawIx2 = StakeProgram.withdraw({
      stakePubkey: stakeAccount1,
      authorizedPubkey: newWithdrawer.publicKey,
      toPubkey: provider.wallet.publicKey,
      lamports: LAMPORTS_PER_SOL * 5,
      custodianPubkey: custodianWallet.publicKey,
    })
    await bankrunExecuteIx(
      provider,
      [custodianWallet, newWithdrawer],
      withdrawIx2
    )

    console.log('5. WE CAN withdraw when lockup is over')
    // moving time forward to expire the lockup
    provider.context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        BigInt(unixTimestampLockup + 1)
      )
    )
    const withdrawIx3 = StakeProgram.withdraw({
      stakePubkey: stakeAccount1,
      authorizedPubkey: newWithdrawer.publicKey,
      toPubkey: provider.wallet.publicKey,
      lamports: LAMPORTS_PER_SOL,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, newWithdrawer],
      withdrawIx3
    )
  })

  it.skip('merge delegated stake account', async () => {
    const clock = await provider.context.banksClient.getClock()
    const custodian = provider.wallet
    const lockup = new Lockup(0, -1, custodian.publicKey) // max lockup at the end of universe
    const staker = Keypair.generate()
    const withdrawer = Keypair.generate()
    // what can happen when not funded enough: custom program error: 0xc => InsufficientDelegation
    const stakeAccount1 = await delegatedStakeAccount({
      provider,
      lockup,
      lamports: LAMPORTS_PER_SOL * 12,
      staker,
      withdrawer,
    })
    const stakeAccount2 = await delegatedStakeAccount({
      provider,
      lockup,
      lamports: LAMPORTS_PER_SOL * 13,
      staker,
      withdrawer,
    })

    console.log(
      '1. CANNOT MERGE WHEN STAKED TO DIFFERENT VOTE ACCOUNTS (the same lockup metadata)'
    )
    const mergeTx = StakeProgram.merge({
      stakePubkey: stakeAccount1.stakeAccount,
      sourceStakePubKey: stakeAccount2.stakeAccount,
      authorizedPubkey: staker.publicKey,
    })
    await verifyErrorMessage(
      provider,
      '1.',
      'custom program error: 0x6', // MergeMismatch
      [provider.wallet, staker],
      mergeTx
    )

    console.log(
      '2. MERGING WHEN STAKED TO THE SAME VOTE ACCOUNT (the same lockup meta data)'
    )
    const delegateIx = StakeProgram.delegate({
      stakePubkey: stakeAccount2.stakeAccount,
      authorizedPubkey: staker.publicKey,
      votePubkey: stakeAccount1.voteAccount,
    })
    await bankrunExecuteIx(provider, [provider.wallet, staker], delegateIx)
    provider.context.warpToSlot(clock.slot + BigInt(1))
    await bankrunExecuteIx(provider, [provider.wallet, staker], mergeTx)
    await assertNotExist(provider, stakeAccount2.stakeAccount)

    console.log('3. CANNOT MERGE DEACTIVATING (the same lockup meta data)')
    const stakeAccount3 = await delegatedStakeAccount({
      provider,
      lockup,
      lamports: LAMPORTS_PER_SOL * 14,
      staker,
      withdrawer,
      voteAccountToDelegate: stakeAccount1.voteAccount,
    })
    let nextEpoch =
      Number((await provider.context.banksClient.getClock()).epoch) + 1
    warpToEpoch(provider, nextEpoch)
    const deactivateIx = StakeProgram.deactivate({
      stakePubkey: stakeAccount3.stakeAccount,
      authorizedPubkey: staker.publicKey,
    })
    await bankrunExecuteIx(provider, [provider.wallet, staker], deactivateIx)
    let [stakeAccount3Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount3.stakeAccount,
      StakeStates.Delegated
    )
    expect(
      stakeAccount3Data.Stake?.stake.delegation.deactivationEpoch.toNumber()
    ).toEqual(nextEpoch)
    const mergeTx3 = StakeProgram.merge({
      stakePubkey: stakeAccount1.stakeAccount,
      sourceStakePubKey: stakeAccount3.stakeAccount,
      authorizedPubkey: staker.publicKey,
    })
    await verifyErrorMessage(
      provider,
      '3.',
      'custom program error: 0x5', // MergeTransientStake
      [provider.wallet, staker],
      mergeTx3
    )

    console.log(
      '4. CANNOT MERGE ON DIFFERENT STATE activated vs. deactivated (the same lockup meta data)'
    )
    nextEpoch =
      Number((await provider.context.banksClient.getClock()).epoch) + 1
    warpToEpoch(provider, nextEpoch)
    await verifyErrorMessage(
      provider,
      '4.',
      'custom program error: 0x6', // MergeMismatch
      [provider.wallet, staker],
      mergeTx3
    )

    console.log('5. stake the deactivated tokens once again')
    const delegateIx3 = StakeProgram.delegate({
      stakePubkey: stakeAccount3.stakeAccount,
      authorizedPubkey: staker.publicKey,
      votePubkey: stakeAccount1.voteAccount,
    })
    await bankrunExecuteIx(provider, [provider.wallet, staker], delegateIx3)
    const currentEpoch = Number(
      (await provider.context.banksClient.getClock()).epoch
    )
    ;[stakeAccount3Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount3.stakeAccount,
      StakeStates.Delegated
    )
    expect(
      stakeAccount3Data.Stake?.stake.delegation.deactivationEpoch.toString()
    ).toEqual('18446744073709551615') // max u64
    expect(
      stakeAccount3Data.Stake?.stake.delegation.activationEpoch.toString()
    ).toEqual(currentEpoch.toString())

    console.log('6. MERGING ACTIVATED stake (the same lockup meta data)')
    warpToEpoch(provider, currentEpoch + 1)
    await bankrunExecuteIx(provider, [provider.wallet, staker], mergeTx3)
    await assertNotExist(provider, stakeAccount3.stakeAccount)
    await getAndCheckStakeAccount(
      provider,
      stakeAccount1.stakeAccount,
      StakeStates.Delegated
    )
    const stakeAccountInfo = await provider.connection.getAccountInfo(
      stakeAccount1.stakeAccount
    )
    expect(stakeAccountInfo?.lamports).toEqual(
      LAMPORTS_PER_SOL * 12 + LAMPORTS_PER_SOL * 13 + LAMPORTS_PER_SOL * 14
    )
  })

  /**
   * What happened with merged lockup?
   * - lockup metadata is the same as the first account where the second was merged into
   */
  it('merging non-locked delegated stake accounts', async () => {
    const clock = await provider.context.banksClient.getClock()
    const staker = Keypair.generate()
    const lockedEpoch = 10
    const lockedTimestamp = 33
    const lockedCustodian = Keypair.generate().publicKey
    const {
      stakeAccount: stakeAccount1,
      withdrawer,
      voteAccount,
    } = await delegatedStakeAccount({
      provider,
      lockup: new Lockup(lockedTimestamp, lockedEpoch, lockedCustodian),
      lamports: LAMPORTS_PER_SOL * 5,
      staker,
    })
    const { stakeAccount: stakeAccount2 } = await delegatedStakeAccount({
      provider,
      voteAccountToDelegate: voteAccount,
      lockup: new Lockup(
        lockedTimestamp - 1,
        lockedEpoch - 1,
        PublicKey.unique()
      ),
      lamports: LAMPORTS_PER_SOL * 6,
      staker,
      withdrawer,
    })
    const [stakeAccount1Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount1,
      StakeStates.Delegated
    )
    const [stakeAccount2Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount2,
      StakeStates.Delegated
    )
    expect(Number(clock.epoch)).toBeGreaterThan(lockedEpoch)
    expect(Number(clock.unixTimestamp)).toBeGreaterThan(lockedTimestamp)
    expect(stakeAccount1Data.Stake?.meta.lockup.epoch.toString()).toEqual(
      lockedEpoch.toString()
    )
    expect(stakeAccount2Data.Stake?.meta.lockup.epoch.toString()).toEqual(
      (lockedEpoch - 1).toString()
    )

    console.log(
      'MERGING delegated to same vote account, non-locked stakes with different lockup meta data'
    )
    const mergeIx = StakeProgram.merge({
      stakePubkey: stakeAccount1,
      sourceStakePubKey: stakeAccount2,
      authorizedPubkey: staker.publicKey,
    })
    await bankrunExecuteIx(provider, [provider.wallet, staker], mergeIx)
    await assertNotExist(provider, stakeAccount2)
    const [stakeAccountData, stakeAccountInfo] = await getAndCheckStakeAccount(
      provider,
      stakeAccount1,
      StakeStates.Delegated
    )
    // lamports matches the sum of the two merged accounts
    expect(stakeAccountInfo.lamports).toEqual(11 * LAMPORTS_PER_SOL)
    // lockup is the same as the first account
    expect(stakeAccountData.Stake?.meta.lockup.epoch.toString()).toEqual(
      lockedEpoch.toString()
    )
    expect(
      stakeAccountData.Stake?.meta.lockup.unixTimestamp.toString()
    ).toEqual(lockedTimestamp.toString())
    expect(stakeAccountData.Stake?.meta.lockup.custodian.toBase58()).toEqual(
      lockedCustodian.toBase58()
    )

    
    const {
      stakeAccount: stakeAccountLocked,
    } = await delegatedStakeAccount({
      provider,
      voteAccountToDelegate: voteAccount,
      lockup: new Lockup(0, Number(clock.epoch) + 1, lockedCustodian),
      lamports: LAMPORTS_PER_SOL * 5,
      staker,
      withdrawer,
    })

    const mergeWithLockedIx = StakeProgram.merge({
      stakePubkey: stakeAccount1,
      sourceStakePubKey: stakeAccountLocked,
      authorizedPubkey: staker.publicKey,
    })
    await bankrunExecuteIx(provider, [provider.wallet, staker], mergeWithLockedIx)
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
  rentExempt = await getRentExemptVote(provider, rentExempt)

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
    throw new Error(`Expected failure ${info}, but it hasn't happened`)
  } catch (e) {
    if (checkErrorMessage(e, checkMessage)) {
      console.debug(`${info} expected error (check: '${checkMessage}')`, e)
    } else {
      console.error(
        `${info} wrong failure thrown, expected error: '${checkMessage}'`,
        e
      )
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

async function assertNotExist(provider: BankrunProvider, account: PublicKey) {
  const accountInfo = await provider.context.banksClient.getAccount(account)
  expect(accountInfo).toBeNull()
}

async function getAndCheckStakeAccount(
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

async function nonInitializedStakeAccount(
  provider: BankrunProvider,
  rentExempt?: number
): Promise<[PublicKey, Keypair]> {
  const accountKeypair = Keypair.generate()
  const createSystemAccountIx = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    newAccountPubkey: accountKeypair.publicKey,
    lamports: await getRentExemptStake(provider, rentExempt),
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
  rentExempt = await getRentExemptStake(provider, rentExempt)

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

type DelegatedStakeAccount = {
  stakeAccount: PublicKey
  voteAccount: PublicKey
  staker: Keypair
  withdrawer: Keypair
}

async function delegatedStakeAccount({
  provider,
  voteAccountToDelegate,
  lockup,
  lamports,
  rentExemptVote,
  staker = Keypair.generate(),
  withdrawer = Keypair.generate(),
}: {
  provider: BankrunProvider
  voteAccountToDelegate?: PublicKey
  lockup?: Lockup
  lamports?: number
  rentExemptVote?: number
  staker?: Keypair
  withdrawer?: Keypair
}): Promise<DelegatedStakeAccount> {
  const stakeAccount = Keypair.generate()
  lamports = await getRentExemptStake(provider, lamports)
  rentExemptVote = await getRentExemptVote(provider, rentExemptVote)

  const createIx = StakeProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(staker.publicKey, withdrawer.publicKey),
    lamports,
    lockup,
  })
  voteAccountToDelegate =
    voteAccountToDelegate ||
    (await createVoteAccount(provider, rentExemptVote)).voteAccount
  const delegateIx = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: staker.publicKey,
    votePubkey: voteAccountToDelegate,
  })
  await bankrunExecuteIx(
    provider,
    [provider.wallet, stakeAccount, staker],
    createIx,
    delegateIx
  )
  return {
    stakeAccount: stakeAccount.publicKey,
    voteAccount: voteAccountToDelegate,
    staker,
    withdrawer,
  }
}

async function getRentExemptStake(
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

async function getRentExemptVote(
  provider: BankrunProvider,
  rentExempt?: number
): Promise<number> {
  return (
    rentExempt ||
    (await provider.connection.getMinimumBalanceForRentExemption(
      VOTE_ACCOUNT_SIZE
    ))
  )
}
