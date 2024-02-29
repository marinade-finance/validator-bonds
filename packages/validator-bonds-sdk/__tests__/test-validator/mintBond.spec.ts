import { Keypair, PublicKey } from '@solana/web3.js'
import {
  MINT_BOND_EVENT,
  MintBondEvent,
  ValidatorBondsProgram,
  mintBondInstruction,
} from '../../src'
import { getValidatorInfo, initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { getAccount as getTokenAccount } from 'solana-spl-token-modern'
import { fetchMetadata } from '@metaplex-foundation/mpl-token-metadata'
import { isSome } from '@metaplex-foundation/umi-options'
import { getUmi, toUmiPubkey } from '../utils/umi'

describe('Validator Bonds mint bond', () => {
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

    const event = new Promise<MintBondEvent>(resolve => {
      const listener = program.addEventListener(
        MINT_BOND_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { instruction, associatedTokenAccount, tokenMetadataAccount } =
      await mintBondInstruction({
        program,
        bondAccount,
        destinationAuthority: validatorIdentity.publicKey,
      })
    await provider.sendIx([], instruction)

    const tokenData = await getTokenAccount(
      provider.connection,
      associatedTokenAccount
    )
    expect(tokenData.amount).toEqual(1)
    const metadata = await fetchMetadata(
      getUmi(provider),
      toUmiPubkey(tokenMetadataAccount)
    )
    expect(isSome(metadata.creators)).toBeTruthy()
    if (isSome(metadata.creators)) {
      expect(metadata.creators.value.length).toEqual(1)
      expect(metadata.creators.value[0].address.toString()).toEqual(
        bondAccount.toBase58()
      )
    } else {
      throw new Error('metadata.creators is not defined')
    }

    await event.then(e => {
      expect(e.bond).toEqual(bondAccount)
      expect(e.destinationAuthority).toEqual(validatorIdentity.publicKey)
      expect(e.destinationTokenAccount).toEqual(associatedTokenAccount)
      expect(e.tokenMetadata).toEqual(tokenMetadataAccount)
    })
  })
})
