import {
  Errors,
  ValidatorBondsProgram,
  bondAddress,
  getBond,
  getConfig,
  initBondInstruction,
} from '../../src'
import { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import {
  executeConfigureConfigInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import {
  createUserAndFund,
  pubkey,
  signer,
} from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds init bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, adminAuthority } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    const config = await getConfig(program, configAccount)
    expect(config.epochsToClaimSettlement).toEqual(1)
    expect(config.withdrawLockupEpochs).toEqual(2)
  })

  it('init bond', async () => {
    const bondAuthority = Keypair.generate()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const rentWallet = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority: bondAuthority.publicKey,
      cpmpe: 30,
      voteAccount,
      validatorIdentity: validatorIdentity.publicKey,
      rentPayer: pubkey(rentWallet),
      maxStakeWanted: 0,
    })
    await provider.sendIx([signer(rentWallet), validatorIdentity], instruction)

    const rentWalletInfo = await provider.connection.getAccountInfo(
      pubkey(rentWallet),
    )
    const bondAccountInfo =
      await provider.connection.getAccountInfo(bondAccount)
    if (bondAccountInfo === null) {
      throw new Error(`Bond account ${bondAccountInfo} not found`)
    }
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        bondAccountInfo.data.length,
      )
    expect(rentWalletInfo!.lamports).toEqual(LAMPORTS_PER_SOL - rentExempt)
    // NO overflow of account size from the first deployment on mainnet
    expect(bondAccountInfo?.data.byteLength).toBeLessThanOrEqual(260)
    console.log('bond account length', bondAccountInfo?.data.byteLength)

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(bondAuthority.publicKey)
    expect(bondData.bump).toEqual(
      bondAddress(configAccount, voteAccount, program.programId)[1],
    )
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.cpmpe).toEqual(30)
    expect(bondData.voteAccount).toEqual(voteAccount)
    expect(bondData.maxStakeWanted).toEqual(0)
  })

  it('init bond permission-less', async () => {
    const bondAuthority = Keypair.generate()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority: bondAuthority.publicKey,
      cpmpe: 88,
      voteAccount,
      maxStakeWanted: 112233,
    })
    await provider.sendIx([], instruction)

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(validatorIdentity.publicKey)
    expect(bondData.bump).toEqual(
      bondAddress(configAccount, voteAccount, program.programId)[1],
    )
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.cpmpe).toEqual(0)
    expect(bondData.maxStakeWanted).toEqual(0)
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
        configAccount,
        bondAuthority: bondAuthority.publicKey,
        cpmpe: 30,
        voteAccount,
        validatorIdentity: authorizedWithdrawer.publicKey,
      })
      await provider.sendIx([authorizedWithdrawer], instruction)
      throw new Error('Should have failed as using wrong identity')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6037,
        'does not match to provided validator identity',
      )
    }
  })

  it('cannot init bond when already exists', async () => {
    const { bondAccount, voteAccount, validatorIdentity } =
      await executeInitBondInstruction({
        program,
        provider,
        configAccount,
      })
    expect(await provider.connection.getAccountInfo(bondAccount)).not.toBeNull()

    try {
      const { instruction } = await initBondInstruction({
        program,
        configAccount,
        bondAuthority: PublicKey.default,
        cpmpe: 30,
        voteAccount,
        validatorIdentity: validatorIdentity!.publicKey,
      })
      await provider.sendIx([validatorIdentity!], instruction)
      throw new Error('Should have failed as bond already exists')
    } catch (e) {
      if (!(e as Error).message.includes('custom program error: 0x0')) {
        console.error(
          `Expected failure as bond account ${bondAccount} should already exist` +
            `'${(e as Error).message}'`,
        )
        throw e
      }
    }
  })

  it('cannot init with wrong min-max stake', async () => {
    const bondAuthority = Keypair.generate()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const rentWallet = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newMinBondMaxStakeWanted: LAMPORTS_PER_SOL,
    })

    const { instruction: initLowerToConfigIx } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority: bondAuthority.publicKey,
      voteAccount,
      validatorIdentity: validatorIdentity.publicKey,
      rentPayer: pubkey(rentWallet),
      maxStakeWanted: 11,
    })
    try {
      await provider.sendIx(
        [signer(rentWallet), validatorIdentity],
        initLowerToConfigIx,
      )
      throw new Error('failure expected as minimum stake under config value')
    } catch (e) {
      verifyError(e, Errors, 6063, 'Max stake wanted value is lower')
    }

    // still possible to init with min-max stake set to 0 despite config is set
    const { instruction: initToZero, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority: bondAuthority.publicKey,
      voteAccount,
      validatorIdentity: validatorIdentity.publicKey,
      rentPayer: pubkey(rentWallet),
      maxStakeWanted: 0,
    })
    await provider.sendIx([signer(rentWallet), validatorIdentity], initToZero)
    const bondData = await getBond(program, bondAccount)
    expect(bondData.maxStakeWanted).toEqual(0)
  })

  it('init bond for downloaded fixtures/accounts', async () => {
    // VoteAccount 1.14.11
    await initAndExpectExist('76sb4FZPwewvxtST5tJMp9N43jj4hDC5DQ7bv8kBi1rA')
    // VoteAccount CURRENT
    await initAndExpectExist('8PMeDKfxUKv4KJBBQJYPmfyZfoYYnMju6fnokRR9uT2w')
  })

  async function initAndExpectExist(pubkey: string) {
    const voteAccount = new PublicKey(pubkey)
    const { instruction: initCurrentTx } = await initBondInstruction({
      program,
      configAccount,
      voteAccount: voteAccount,
    })
    await provider.sendIx([], initCurrentTx)
    expect(await provider.connection.getAccountInfo(voteAccount)).not.toBeNull()
  }
})
