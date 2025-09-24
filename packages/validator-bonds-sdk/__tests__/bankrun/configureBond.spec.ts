import { verifyError } from '@marinade.finance/anchor-common'
import { Keypair, PublicKey } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  Errors,
  configureBondInstruction,
  getBond,
  getConfig,
  initBondInstruction,
} from '../../src'
import { createVoteAccount } from '../utils/staking'
import {
  executeConfigureConfigInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'

import type { Bond, ValidatorBondsProgram } from '../../src'
import type { ProgramAccount } from '@coral-xyz/anchor'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'

describe('Validator Bonds configure bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
  let voterAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, adminAuthority } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    const {
      voteAccount,
      validatorIdentity: nodePubkey,
      authorizedVoter,
    } = await createVoteAccount({ provider })
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      bondAuthority,
      voteAccount,
      validatorIdentity: nodePubkey,
      cpmpe: 123,
    })
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newMinBondMaxStakeWanted: 1000,
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
      newMaxStakeWanted: 10123,
    })
    await provider.sendIx([bondAuthority], ix1)

    let bondData = await getBond(program, bond.publicKey)
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
    expect(bondData.cpmpe).toEqual(321)
    expect(bondData.maxStakeWanted).toEqual(10123)

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
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
  })

  it('fails to configure with voter authority', async () => {
    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      configAccount,
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
      configAccount,
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

  it('configures bond max stake wanted', async () => {
    let bondData = await getBond(program, bond.publicKey)
    expect(bondData.maxStakeWanted).toEqual(0)

    const { instruction: ix2 } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: validatorIdentity,
      newMaxStakeWanted: 999,
    })
    try {
      await provider.sendIx([validatorIdentity], ix2)
      throw new Error('failure expected as min stake goes below limit')
    } catch (e) {
      verifyError(e, Errors, 6063, 'Max stake wanted value is lower')
    }
    bondData = await getBond(program, bond.publicKey)
    expect(bondData.maxStakeWanted).toEqual(0)

    // value 0 can be set in whatever case
    const { instruction: ix3 } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: bondAuthority,
      newMaxStakeWanted: 0,
    })
    await provider.sendIx([bondAuthority], ix3)
    bondData = await getBond(program, bond.publicKey)
    expect(bondData.maxStakeWanted).toEqual(0)

    // min and max can be the same
    const configData = await getConfig(program, configAccount)
    const { instruction: ix4 } = await configureBondInstruction({
      program,
      bondAccount: bond.publicKey,
      authority: bondAuthority,
      newMaxStakeWanted: configData.minBondMaxStakeWanted,
    })
    await provider.sendIx([bondAuthority], ix4)
    bondData = await getBond(program, bond.publicKey)
    expect(bondData.maxStakeWanted).toEqual(configData.minBondMaxStakeWanted)
  })
})
