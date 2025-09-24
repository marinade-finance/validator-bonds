import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import {
  executeTxSimple,
  signer,
  splitAndExecuteTx,
  transaction,
} from '@marinade.finance/web3js-1x'
import { Keypair, PublicKey } from '@solana/web3.js'

import {
  INIT_BOND_EVENT,
  assertEvent,
  bondAddress,
  findBonds,
  getBond,
  initBondInstruction,
  parseCpiEvents,
} from '../../src'
import { createVoteAccountWithIdentity } from '../utils/staking'
import {
  executeConfigureConfigInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { Wallet } from '@marinade.finance/web3js-1x'
import type { Signer } from '@solana/web3.js'

describe('Validator Bonds init bond', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
  })

  beforeEach(async () => {
    const { configAccount: ca, adminAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
      })
    configAccount = ca
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newMinBondMaxStakeWanted: 10_000,
    })
  })

  it('init bond', async () => {
    const { voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity
    )

    const tx = await transaction(provider)

    const bondAuthority = PublicKey.unique()
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority,
      cpmpe: 22,
      voteAccount,
      validatorIdentity: validatorIdentity.publicKey,
      maxStakeWanted: 1_000_000,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      validatorIdentity,
    ])

    const bondsDataFromList = await findBonds({
      program,
      configAccount,
      voteAccount,
      bondAuthority,
    })
    expect(bondsDataFromList.length).toEqual(1)

    const bondData = await getBond(program, bondAccount)

    const [bondCalculatedAddress, bondBump] = bondAddress(
      configAccount,
      voteAccount,
      program.programId
    )
    expect(bondCalculatedAddress).toEqual(bondAccount)
    expect(bondData.authority).toEqual(bondAuthority)
    expect(bondData.bump).toEqual(bondBump)
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.cpmpe).toEqual(22)
    expect(bondData.voteAccount).toEqual(voteAccount)
    expect(bondData.maxStakeWanted).toEqual(1_000_000)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, INIT_BOND_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.bond).toEqual(bondAccount)
    expect(e.authority).toEqual(bondAuthority)
    expect(e.config).toEqual(configAccount)
    expect(e.cpmpe).toEqual(22)
    expect(e.voteAccount).toEqual(voteAccount)
    expect(e.validatorIdentity).toEqual(validatorIdentity.publicKey)
    expect(e.maxStakeWanted).toEqual(1_000_000)
  })

  it('find bonds', async () => {
    const bondAuthority = Keypair.generate().publicKey

    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [provider.wallet]

    const numberOfBonds = 24

    const voteAccounts: [PublicKey, Keypair][] = []
    for (let i = 1; i <= numberOfBonds; i++) {
      const { voteAccount: voteAccount } = await createVoteAccountWithIdentity(
        provider,
        validatorIdentity
      )
      voteAccounts.push([voteAccount, validatorIdentity])
      signers.push(signer(validatorIdentity))
    }

    for (let i = 1; i <= numberOfBonds; i++) {
      const voteAndBondEntry = voteAccounts[i - 1]
      assert(voteAndBondEntry !== undefined)
      const [voteAccount, nodeIdentity] = voteAndBondEntry
      const { instruction } = await initBondInstruction({
        program,
        configAccount,
        bondAuthority: bondAuthority,
        cpmpe: 100,
        voteAccount,
        validatorIdentity: nodeIdentity,
      })
      tx.add(instruction)
    }
    expect(tx.instructions.length).toEqual(numberOfBonds)
    await splitAndExecuteTx({
      connection: provider.connection,
      transaction: tx,
      signers,
      errMessage: 'Failed to init bonds',
    })

    let bondDataFromList = await findBonds({ program, bondAuthority })
    expect(bondDataFromList.length).toEqual(numberOfBonds)

    bondDataFromList = await findBonds({
      program,
      configAccount: configAccount,
    })
    expect(bondDataFromList.length).toEqual(numberOfBonds)

    for (let i = 1; i <= numberOfBonds; i++) {
      const voteAndBondEntry = voteAccounts[i - 1]
      assert(voteAndBondEntry !== undefined)
      const [voteAccount] = voteAndBondEntry
      bondDataFromList = await findBonds({
        program,
        voteAccount,
      })
      expect(bondDataFromList.length).toEqual(1)
    }

    bondDataFromList = await findBonds({
      program,
      bondAuthority,
      configAccount,
    })
    expect(bondDataFromList.length).toEqual(numberOfBonds)
  })
})
