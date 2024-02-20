import {
  Bond,
  Config,
  Errors,
  ValidatorBondsProgram,
  configureBondInstruction,
  getBond,
  getConfig,
  initBondInstruction,
} from '../../src'
import { BankrunExtendedProvider, initBankrunTest } from './bankrun'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import { verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds configure bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
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
    const {
      voteAccount,
      validatorIdentity: nodePubkey,
      authorizedVoter,
    } = await createVoteAccount({ provider })
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      config: config.publicKey,
      bondAuthority,
      voteAccount,
      validatorIdentity: nodePubkey,
      cpmpe: 123,
    })
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
    validatorIdentity = nodePubkey
    voterAuthority = authorizedVoter
  })

  it('configures bond with bond authority and then back', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction: ix1 } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: bondAuthority,
      newBondAuthority: newBondAuthority.publicKey,
      newCpmpe: 321,
    })
    await provider.sendIx([bondAuthority], ix1)

    let bondData = await getBond(program, bond.publicKey)
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
    expect(bondData.cpmpe).toEqual(321)

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
      authority: validatorIdentity,
      newBondAuthority: newBondAuthority.publicKey,
    })
    await provider.sendIx([validatorIdentity], instruction)

    const bondData = await getBond(program, bond.publicKey)
    expect(bondData.config).toEqual(config.publicKey)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
  })

  it('fails to configure with voter authority', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      configAccount: config.publicKey,
      voteAccount: bond.account.voteAccount,
      authority: voterAuthority,
      newBondAuthority: newBondAuthority.publicKey,
    })
    try {
      await provider.sendIx([voterAuthority], instruction)
      throw new Error('failure expected as wrong admin')
    } catch (e) {
      verifyError(e, Errors, 6018, 'Wrong authority')
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
      verifyError(e, Errors, 6018, 'Wrong authority')
    }
  })

  it('configure bond with validator identity', async () => {
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    // permission-less creation
    const {
      instruction: createBondIx,
      bondAccount: permissionLessBondAccount,
    } = await initBondInstruction({
      program,
      configAccount: config.publicKey,
      voteAccount,
    })
    await provider.sendIx([], createBondIx)

    const randomAuthority = Keypair.generate()
    const { instruction: ixWrongAuth } = await configureBondInstruction({
      program,
      bondAccount: permissionLessBondAccount,
      authority: randomAuthority.publicKey,
      newBondAuthority: PublicKey.default,
    })
    try {
      await provider.sendIx([randomAuthority], ixWrongAuth)
      throw new Error('failure expected; wrong authority validator identity')
    } catch (e) {
      verifyError(e, Errors, 6018, 'Wrong authority')
    }
    let bondsData = await getBond(program, permissionLessBondAccount)
    expect(bondsData.authority).toEqual(validatorIdentity.publicKey)

    const { instruction } = await configureBondInstruction({
      program,
      bondAccount: permissionLessBondAccount,
      authority: validatorIdentity.publicKey,
      newBondAuthority: PublicKey.default,
    })
    await provider.sendIx([validatorIdentity], instruction)
    bondsData = await getBond(program, permissionLessBondAccount)
    expect(bondsData.authority).toEqual(PublicKey.default)
  })
})
