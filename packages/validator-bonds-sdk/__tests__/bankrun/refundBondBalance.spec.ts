import { verifyError } from '@marinade.finance/anchor-common'
import { warpToEpoch, warpToNextEpoch } from '@marinade.finance/bankrun-utils'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  StakeProgram,
  SystemProgram,
} from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  Errors,
  bondsWithdrawerAuthority,
  claimWithdrawRequestInstruction,
  deserializeStakeState,
  emergencyPauseInstruction,
  getBond,
  refundBondBalanceInstruction,
} from '../../src'
import { getSecureRandomInt } from '../utils/helpers'
import {
  authorizeStakeAccount,
  createBondsFundedStakeAccount,
  createDelegatedStakeAccount,
  createSettlementFundedDelegatedStake,
  createVoteAccount,
  delegatedStakeAccount,
} from '../utils/staking'
import {
  executeConfigureConfigInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'

import type { Bond, ValidatorBondsProgram } from '../../src'
import type { ProgramAccount } from '@coral-xyz/anchor'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds refund bond balance', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let bond: ProgramAccount<Bond>
  let validatorIdentity: Keypair
  const startUpEpoch = getSecureRandomInt(100, 200)
  const withdrawLockupEpochs = 1

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount, adminAuthority } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs,
    }))
    const { voteAccount, validatorIdentity: nodeIdentity } =
      await createVoteAccount({ provider })
    validatorIdentity = nodeIdentity
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  async function transferToBond(lamports: number) {
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.walletPubkey,
      toPubkey: bond.publicKey,
      lamports,
    })
    await provider.sendIx([], transferIx)
  }

  async function bondRentExempt(): Promise<number> {
    const bondInfo = await provider.connection.getAccountInfo(bond.publicKey)
    expect(bondInfo).not.toBeNull()
    return await provider.connection.getMinimumBalanceForRentExemption(
      bondInfo!.data.length,
    )
  }

  async function lamportsOf(address: PublicKey): Promise<number> {
    const info = await provider.connection.getAccountInfo(address)
    expect(info).not.toBeNull()
    return info!.lamports
  }

  it('refund bond balance to bond funded stake account', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const excess = 2.5 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(excess)

    const rentExempt = await bondRentExempt()
    expect(await lamportsOf(bond.publicKey)).toEqual(rentExempt + excess)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)

    expect(await lamportsOf(bond.publicKey)).toEqual(rentExempt)
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)
  })

  it('refund dust amount', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const dust = 12345
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(dust)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)

    expect(await lamportsOf(bond.publicKey)).toEqual(await bondRentExempt())
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + dust)
  })

  it('cannot refund when no excess lamports', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as no excess lamports')
    } catch (e) {
      verifyError(e, Errors, 6079, 'no lamports above the rent-exempt')
    }
  })

  it('cannot refund to stake account not funded to the bond', async () => {
    const nonBondAuthority = Keypair.generate().publicKey
    const stakeAccount = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
      withdrawer: nonBondAuthority,
      staker: nonBondAuthority,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as stake account is not bond funded')
    } catch (e) {
      verifyError(e, Errors, 6012, 'Wrong withdrawer authority')
    }
  })

  it('cannot refund to settlement funded stake account', async () => {
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: Keypair.generate().publicKey,
      voteAccount: bond.account.voteAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as funded to settlement')
    } catch (e) {
      verifyError(e, Errors, 6028, 'already funded to a settlement')
    }
  })

  it('cannot refund to stake account delegated to different vote account', async () => {
    const { voteAccount: differentVoteAccount } = await createVoteAccount({
      provider,
    })
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const stakeAccount = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: differentVoteAccount,
      withdrawer: bondsAuth,
      staker: bondsAuth,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as delegated to wrong validator')
    } catch (e) {
      verifyError(e, Errors, 6020, 'delegated to a wrong validator')
    }
  })

  it('cannot refund to locked stake account', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const currentEpoch = Number(
      (await provider.context.banksClient.getClock()).epoch,
    )
    const custodian = Keypair.generate()
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
      lockup: {
        custodian: custodian.publicKey,
        epoch: currentEpoch + 10,
        unixTimestamp: 0,
      },
    })
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
      custodian,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as stake account is locked')
    } catch (e) {
      verifyError(e, Errors, 6030, 'stake account is locked-up')
    }
  })

  it('cannot refund to deactivated stake account', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
    })
    await warpToNextEpoch(provider)
    const deactivateIx = StakeProgram.deactivate({
      stakePubkey: stakeAccount,
      authorizedPubkey: staker.publicKey,
    })
    await provider.sendIx([provider.wallet, staker], deactivateIx)
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
    })
    await warpToNextEpoch(provider)
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as stake account is deactivated')
    } catch (e) {
      verifyError(e, Errors, 6064, 'not activating or activated')
    }
  })

  it('cannot refund when program is paused', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const pauseAuthority = Keypair.generate()
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newPauseAuthority: pauseAuthority.publicKey,
    })
    const { instruction: pauseIx } = await emergencyPauseInstruction({
      program,
      configAccount,
      pauseAuthority: pauseAuthority.publicKey,
    })
    await provider.sendIx([pauseAuthority], pauseIx)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as program is paused')
    } catch (e) {
      verifyError(e, Errors, 6054, 'Emergency Pause is Active')
    }
  })

  it('refunded amount is claimable through withdraw request', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const excess = 3 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(excess)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)

    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        bondAccount: bond.publicKey,
        configAccount,
        validatorIdentity,
        amount: stakeLamports + excess,
      })
    const withdrawer = Keypair.generate()
    const { instruction: claimIx, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount,
        bondAccount: bond.publicKey,
        stakeAccount,
        withdrawer: withdrawer.publicKey,
      })
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await provider.sendIx([splitStakeAccount, validatorIdentity], claimIx)

    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)
    const stakeAccountInfo =
      await provider.connection.getAccountInfo(stakeAccount)
    const stakeAccountData = deserializeStakeState(stakeAccountInfo?.data)
    expect(stakeAccountData.Stake?.meta.authorized.staker).toEqual(
      withdrawer.publicKey,
    )
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      withdrawer.publicKey,
    )
  })
})
