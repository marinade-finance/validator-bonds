import { Keypair, PublicKey } from '@solana/web3.js'
import {
  MINT_BOND_EVENT,
  ValidatorBondsProgram,
  assertEvent,
  mintBondInstruction,
  parseCpiEvents,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import { getAccount as getTokenAccount } from 'solana-spl-token-modern'
import { fetchMetadata } from '@metaplex-foundation/mpl-token-metadata'
import { isSome } from '@metaplex-foundation/umi-options'
import { getUmi, toUmiPubkey } from '@marinade.finance/umi-utils'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds mint bond', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
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

    const tx = await transaction(provider)

    const { instruction, validatorIdentityTokenAccount, tokenMetadataAccount } =
      await mintBondInstruction({
        program,
        bondAccount,
        validatorIdentity: validatorIdentity.publicKey,
      })
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
    ])

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

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, MINT_BOND_EVENT)
    assert(e !== undefined)
    expect(e.bond).toEqual(bondAccount)
    expect(e.validatorIdentity).toEqual(validatorIdentity.publicKey)
    expect(e.validatorIdentityTokenAccount).toEqual(
      validatorIdentityTokenAccount
    )
    expect(e.tokenMetadata).toEqual(tokenMetadataAccount)
  })
})
