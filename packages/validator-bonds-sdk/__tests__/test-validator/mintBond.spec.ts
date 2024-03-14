import { Keypair, PublicKey } from '@solana/web3.js'
import {
  MINT_BOND_EVENT,
  MintBondEvent,
  ValidatorBondsProgram,
  mintBondInstruction,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '@marinade.finance/web3js-common'
import { getAccount as getTokenAccount } from 'solana-spl-token-modern'
import { fetchMetadata } from '@metaplex-foundation/mpl-token-metadata'
import { isSome } from '@metaplex-foundation/umi-options'
import { getUmi, toUmiPubkey } from '@marinade.finance/umi-utils'
import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'

describe('Validator Bonds mint bond', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
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

    const { instruction, validatorIdentityTokenAccount, tokenMetadataAccount } =
      await mintBondInstruction({
        program,
        bondAccount,
        validatorIdentity: validatorIdentity.publicKey,
      })
    await provider.sendIx([], instruction)

    const tokenData = await getTokenAccount(
      provider.connection,
      validatorIdentityTokenAccount
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
      expect(e.validatorIdentity).toEqual(validatorIdentity.publicKey)
      expect(e.validatorIdentityTokenAccount).toEqual(
        validatorIdentityTokenAccount
      )
      expect(e.tokenMetadata).toEqual(tokenMetadataAccount)
    })
  })
})
