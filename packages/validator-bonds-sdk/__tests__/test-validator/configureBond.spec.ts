import { Keypair, PublicKey } from '@solana/web3.js'
import {
  CONFIGURE_BOND_EVENT,
  ConfigureBondEvent,
  ValidatorBondsProgram,
  configureBondInstruction,
  getBond,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'

describe('Validator Bonds configure bond', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
  })

  it('configure bond', async () => {
    const { bondAccount, bondAuthority } = await executeInitBondInstruction(
      program,
      provider,
      configAccount,
      undefined,
      undefined,
      undefined,
      22
    )

    const event = new Promise<ConfigureBondEvent>(resolve => {
      const listener = program.addEventListener(
        CONFIGURE_BOND_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      bondAccount,
      authority: bondAuthority,
      newBondAuthority: newBondAuthority.publicKey,
      newRevenueShareHundredthBps: 31,
    })
    await provider.sendIx([bondAuthority], instruction)

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.revenueShare).toEqual({ hundredthBps: 31 })
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)

    await event.then(e => {
      expect(e.bondAuthority).toEqual({
        old: bondAuthority.publicKey,
        new: newBondAuthority.publicKey,
      })
      expect(e.revenueShare).toEqual({
        old: { hundredthBps: 22 },
        new: { hundredthBps: 31 },
      })
    })
  })
})
