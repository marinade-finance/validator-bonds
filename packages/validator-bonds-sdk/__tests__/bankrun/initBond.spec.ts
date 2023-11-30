import {
  Config,
  ValidatorBondsProgram,
  bondAddress,
  getBond,
  getConfig,
  initBondInstruction,
} from '../../src'
import { BankrunExtendedProvider, initBankrunTest } from './bankrun'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'

describe('Validator Bonds init bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction(
      program,
      provider,
      1,
      2
    )
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
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount: config.publicKey,
      bondAuthority: bondAuthority.publicKey,
      revenueShareHundredthBps: 30,
      validatorVoteAccount: voteAccount,
      validatorVoteWithdrawer: authorizedWithdrawer.publicKey,
    })
    await provider.sendIx([provider.wallet, authorizedWithdrawer], instruction)

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
