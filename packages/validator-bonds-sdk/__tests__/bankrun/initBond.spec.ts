import {
  Config,
  Errors,
  ValidatorBondsProgram,
  bondAddress,
  getBond,
  getConfig,
  initBondInstruction,
} from '../../src'
import { BankrunExtendedProvider, initBankrunTest } from './bankrun'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'

import { pubkey, signer } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds init bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    expect(config.account.epochsToClaimSettlement).toEqual(1)
    expect(config.account.withdrawLockupEpochs).toEqual(2)
  })

  it('init bond', async () => {
    const bondAuthority = Keypair.generate()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const rentWallet = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount: config.publicKey,
      bondAuthority: bondAuthority.publicKey,
      cpmpe: 30,
      voteAccount: voteAccount,
      validatorIdentity: validatorIdentity.publicKey,
      rentPayer: pubkey(rentWallet),
    })
    await provider.sendIx([signer(rentWallet), validatorIdentity], instruction)

    const rentWalletInfo = await provider.connection.getAccountInfo(
      pubkey(rentWallet)
    )
    const bondAccountInfo =
      await provider.connection.getAccountInfo(bondAccount)
    if (bondAccountInfo === null) {
      throw new Error(`Bond account ${bondAccountInfo} not found`)
    }
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        bondAccountInfo.data.length
      )
    expect(rentWalletInfo!.lamports).toEqual(LAMPORTS_PER_SOL - rentExempt)
    // NO overflow of account size from the first deployment on mainnet
    expect(bondAccountInfo?.data.byteLength).toBeLessThanOrEqual(260)
    console.log('bond account length', bondAccountInfo?.data.byteLength)

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(bondAuthority.publicKey)
    expect(bondData.bump).toEqual(
      bondAddress(config.publicKey, voteAccount, program.programId)[1]
    )
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.cpmpe).toEqual(30)
    expect(bondData.voteAccount).toEqual(voteAccount)
  })

  it('init bond permission-less', async () => {
    const bondAuthority = Keypair.generate()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount: config.publicKey,
      bondAuthority: bondAuthority.publicKey,
      cpmpe: 88,
      voteAccount,
    })
    await provider.sendIx([], instruction)

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(validatorIdentity.publicKey)
    expect(bondData.bump).toEqual(
      bondAddress(config.publicKey, voteAccount, program.programId)[1]
    )
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.cpmpe).toEqual(0)
    expect(bondData.voteAccount).toEqual(voteAccount)
  })

  it('init bond failure on vote account withdrawer signature', async () => {
    const bondAuthority = Keypair.generate()
    const { voteAccount, authorizedWithdrawer } = await createVoteAccount({
      provider,
    })

    try {
      const { instruction } = await initBondInstruction({
        program,
        configAccount: config.publicKey,
        bondAuthority: bondAuthority.publicKey,
        cpmpe: 30,
        voteAccount: voteAccount,
        validatorIdentity: authorizedWithdrawer.publicKey,
      })
      await provider.sendIx([authorizedWithdrawer], instruction)
      throw new Error('Should have failed as using wrong identity')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6037,
        'does not match to provided validator identity'
      )
    }
  })

  it('cannot init bond when already exists', async () => {
    const { bondAccount, voteAccount, validatorIdentity } =
      await executeInitBondInstruction({
        program,
        provider,
        config: config.publicKey,
      })
    expect(
      provider.connection.getAccountInfo(bondAccount)
    ).resolves.not.toBeNull()

    try {
      const { instruction } = await initBondInstruction({
        program,
        configAccount: config.publicKey,
        bondAuthority: PublicKey.default,
        cpmpe: 30,
        voteAccount: voteAccount,
        validatorIdentity: validatorIdentity.publicKey,
      })
      await provider.sendIx([validatorIdentity], instruction)
      throw new Error('Should have failed as bond already exists')
    } catch (e) {
      if (!(e as Error).message.includes('custom program error: 0x0')) {
        console.error(
          `Expected failure as bond account ${bondAccount} should already exist` +
            `'${(e as Error).message}'`
        )
        throw e
      }
    }
  })
})
