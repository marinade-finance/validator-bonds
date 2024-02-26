import { Keypair, PublicKey } from '@solana/web3.js'
import {
  CONFIGURE_BOND_EVENT,
  ConfigureBondEvent,
  ValidatorBondsProgram,
  configureBondWithMintInstruction,
  getBond,
  mintBondInstruction,
} from '../../src'
import { getValidatorInfo, initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { getAccount as getTokenAccount } from 'solana-spl-token-modern'

describe('Validator Bonds configure bond with mint', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getValidatorInfo(provider.connection))
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

  it('mint bond', async () => {
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      validatorIdentity,
    })
    const oldBondData = await getBond(program, bondAccount)

    const event = new Promise<ConfigureBondEvent>(resolve => {
      const listener = program.addEventListener(
        CONFIGURE_BOND_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { instruction: ixMint, associatedTokenAccount } =
      await mintBondInstruction({
        program,
        bondAccount,
        destinationAuthority: validatorIdentity.publicKey,
      })
    const newBondAuthority = PublicKey.unique()
    const newCpmpe = 1000
    const { instruction } = await configureBondWithMintInstruction({
      program,
      bondAccount,
      tokenAuthority: validatorIdentity.publicKey,
      newCpmpe,
      newBondAuthority,
    })
    await provider.sendIx([validatorIdentity], ixMint, instruction)

    const tokenData = await getTokenAccount(
      provider.connection,
      associatedTokenAccount
    )
    expect(tokenData.amount).toEqual(0) // burnt
    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(newBondAuthority)
    expect(bondData.cpmpe).toEqual(newCpmpe)

    await event.then(e => {
      expect(e.bondAuthority).toEqual({
        old: oldBondData.authority,
        new: newBondAuthority,
      })
      expect(e.cpmpe).toEqual({
        old: oldBondData.cpmpe,
        new: newCpmpe,
      })
    })
  })
})
