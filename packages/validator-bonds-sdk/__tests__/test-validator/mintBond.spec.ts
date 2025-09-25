import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'
import { fetchMetadata } from '@metaplex-foundation/mpl-token-metadata'
import { isSome } from '@metaplex-foundation/umi-options'
import { getAccount as getTokenAccount } from 'solana-spl-token-modern'

import {
  MINT_BOND_EVENT,
  assertEvent,
  mintBondInstruction,
  parseCpiEvents,
} from '../../src'
import { getUmi, toUmiPubkey } from '../utils/mi'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Validator Bonds mint bond', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = initTest())
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

    expect(isSome(metadata.creators)).toBe(true)
    assert(isSome(metadata.creators))
    expect(metadata.creators.value.length).toEqual(1)
    expect(metadata.creators.value[0]?.address.toString()).toEqual(
      bondAccount.toBase58()
    )

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
