import {
  Config,
  ValidatorBondsProgram,
  bondAddress,
  getBond,
  getConfig,
  initBondInstruction,
} from '../../src'
import { BankrunExtendedProvider, initBankrunTest } from './bankrun'
import {
  createUserAndFund,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'

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
    const { voteAccount, authorizedWithdrawer } = await createVoteAccount(
      provider
    )
    const rentWallet = await createUserAndFund(
      provider,
      Keypair.generate(),
      LAMPORTS_PER_SOL
    )
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount: config.publicKey,
      bondAuthority: bondAuthority.publicKey,
      revenueShareHundredthBps: 30,
      validatorVoteAccount: voteAccount,
      validatorVoteWithdrawer: authorizedWithdrawer.publicKey,
      rentPayer: rentWallet.publicKey,
    })
    await provider.sendIx([rentWallet, authorizedWithdrawer], instruction)

    const rentWalletInfo = await provider.connection.getAccountInfo(
      rentWallet.publicKey
    )
    const bondAccountInfo = await provider.connection.getAccountInfo(
      bondAccount
    )
    if (bondAccountInfo === null) {
      throw new Error(`Bond account ${bondAccountInfo} not found`)
    }
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        bondAccountInfo.data.length
      )
    expect(rentWalletInfo!.lamports).toEqual(LAMPORTS_PER_SOL - rentExempt)
    console.log(
      `Bond record data length ${bondAccountInfo.data.length}, exempt rent: ${rentExempt}`
    )

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(bondAuthority.publicKey)
    expect(bondData.bump).toEqual(
      bondAddress(config.publicKey, voteAccount, program.programId)[1]
    )
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.revenueShare).toEqual({ hundredthBps: 30 })
    expect(bondData.validatorVoteAccount).toEqual(voteAccount)
  })
})
