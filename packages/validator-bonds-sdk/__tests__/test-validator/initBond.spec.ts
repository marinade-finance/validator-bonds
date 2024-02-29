import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import {
  INIT_BOND_EVENT,
  InitBondEvent,
  ValidatorBondsProgram,
  bondAddress,
  findBonds,
  getBond,
  initBondInstruction,
} from '../../src'
import { getValidatorInfo, initTest } from './testValidator'
import {
  Wallet,
  signer,
  splitAndExecuteTx,
  transaction,
} from '@marinade.finance/web3js-common'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { createVoteAccountWithIdentity } from '../utils/staking'
import { AnchorProvider } from '@coral-xyz/anchor'

describe('Validator Bonds init bond', () => {
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

  it('init bond', async () => {
    const event = new Promise<InitBondEvent>(resolve => {
      const listener = program.addEventListener(
        INIT_BOND_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity
    )
    const bondAuthority = PublicKey.unique()
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority,
      cpmpe: 22,
      voteAccount,
      validatorIdentity: validatorIdentity.publicKey,
    })
    await provider.sendIx([validatorIdentity], instruction)

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

    // Ensure the event listener was called
    await event.then(e => {
      expect(e.bond).toEqual(bondAccount)
      expect(e.authority).toEqual(bondAuthority)
      expect(e.config).toEqual(configAccount)
      expect(e.cpmpe).toEqual(22)
      expect(e.voteAccount).toEqual(voteAccount)
      expect(e.validatorIdentity).toEqual(validatorIdentity.publicKey)
    })
  })

  it('find bonds', async () => {
    const bondAuthority = Keypair.generate().publicKey

    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [
      (provider as unknown as AnchorProvider).wallet,
    ]

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
      const [voteAccount, nodeIdentity] = voteAccounts[i - 1]
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
      const [voteAccount] = voteAccounts[i - 1]
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
