import {
  Bond,
  Config,
  ValidatorBondsProgram,
  configureBondInstruction,
  getBond,
  getConfig,
} from '../../src'
import { BankrunExtendedProvider, initBankrunTest } from './bankrun'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import { checkAnchorErrorMessage } from '../utils/helpers'

describe('Validator Bonds configure bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let withdrawerAuthority: Keypair
  let voterAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    const { voteAccount, authorizedWithdrawer, authorizedVoter } =
      await createVoteAccount(provider)
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction(
      program,
      provider,
      config.publicKey,
      bondAuthority,
      voteAccount,
      authorizedWithdrawer,
      123
    )
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
    withdrawerAuthority = authorizedWithdrawer
    voterAuthority = authorizedVoter
  })

  it('configures bond with bond authority and then back', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction: ix1 } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: bondAuthority,
      newBondAuthority: newBondAuthority.publicKey,
      newRevenueShareHundredthBps: 321,
    })
    await provider.sendIx([bondAuthority], ix1)

    let bondData = await getBond(program, bond.publicKey)
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
    expect(bondData.revenueShare).toEqual({ hundredthBps: 321 })

    const { instruction: ix2 } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: newBondAuthority.publicKey,
      newBondAuthority: bondAuthority.publicKey,
    })
    await provider.sendIx([newBondAuthority], ix2)

    bondData = await getBond(program, bond.publicKey)
    expect(bondData.authority).toEqual(bondAuthority.publicKey)
  })

  it('configures bond with withdrawer authority', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: withdrawerAuthority,
      newBondAuthority: newBondAuthority.publicKey,
    })
    await provider.sendIx([withdrawerAuthority], instruction)

    const bondData = await getBond(program, bond.publicKey)
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
  })

  it('fails to configure with voter authority', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      configAccount: config.publicKey,
      validatorVoteAccount: bond.account.validatorVoteAccount,
      authority: voterAuthority,
      newBondAuthority: newBondAuthority.publicKey,
    })
    try {
      await provider.sendIx([voterAuthority], instruction)
      throw new Error('failure expected as wrong admin')
    } catch (e) {
      checkAnchorErrorMessage(e, 6016, 'Wrong authority')
    }
  })

  it('fails to configure with a random authority', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: newBondAuthority,
      newBondAuthority: newBondAuthority.publicKey,
    })
    try {
      await provider.sendIx([newBondAuthority], instruction)
      throw new Error('failure expected as wrong admin')
    } catch (e) {
      checkAnchorErrorMessage(e, 6016, 'Wrong authority')
    }
  })
})
