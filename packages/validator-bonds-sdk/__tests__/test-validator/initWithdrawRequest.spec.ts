import { Keypair, LAMPORTS_PER_SOL, PublicKey, Signer } from '@solana/web3.js'
import {
  INIT_WITHDRAW_REQUEST_EVENT,
  InitWithdrawRequestEvent,
  ValidatorBondsProgram,
  findWithdrawRequests,
  getWithdrawRequest,
  initBondInstruction,
  initWithdrawRequestInstruction,
  withdrawRequestAddress,
} from '../../src'
import { getValidatorInfo, initTest, waitForNextEpoch } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import {
  createVoteAccount,
  createVoteAccountWithIdentity,
} from '../utils/staking'
import { AnchorProvider } from '@coral-xyz/anchor'
import {
  Wallet,
  splitAndExecuteTx,
  signer,
  transaction,
} from '@marinade.finance/web3js-common'

describe('Validator Bonds init withdraw request', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let bondAuthority: Keypair
  let voteAccount: PublicKey
  let validatorIdentity: Keypair

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
    const { voteAccount: validatorVoteAccount, validatorIdentity } =
      await createVoteAccount({ provider })
    voteAccount = validatorVoteAccount
    ;({ bondAccount, bondAuthority } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  it('init withdraw request', async () => {
    const event = new Promise<InitWithdrawRequestEvent>(resolve => {
      const listener = program.addEventListener(
        INIT_WITHDRAW_REQUEST_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { instruction, withdrawRequestAccount } =
      await initWithdrawRequestInstruction({
        program,
        bondAccount,
        configAccount,
        authority: bondAuthority,
        amount: 2 * LAMPORTS_PER_SOL,
      })
    await provider.sendIx([bondAuthority], instruction)

    const withdrawRequestList = await findWithdrawRequests({
      program,
      voteAccount,
    })
    expect(withdrawRequestList.length).toEqual(1)

    const epoch = (await provider.connection.getEpochInfo()).epoch
    const [, bump] = withdrawRequestAddress(bondAccount, program.programId)
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.bond).toEqual(bondAccount)
    expect(withdrawRequestData.bump).toEqual(bump)
    expect(withdrawRequestData.epoch).toEqual(epoch)
    expect(withdrawRequestData.requestedAmount).toEqual(2 * LAMPORTS_PER_SOL)
    expect(withdrawRequestData.voteAccount).toEqual(voteAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)

    await event.then(e => {
      expect(e.withdrawRequest).toEqual(withdrawRequestAccount)
      expect(e.bond).toEqual(bondAccount)
      expect(e.epoch).toEqual(epoch)
      expect(e.requestedAmount).toEqual(2 * LAMPORTS_PER_SOL)
      expect(e.voteAccount).toEqual(voteAccount)
    })
  })

  it('find withdraw request', async () => {
    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [
      (provider as unknown as AnchorProvider).wallet,
    ]

    const numberOfBonds = 24

    signers.push(signer(validatorIdentity))
    const voteAndBonds: [PublicKey, PublicKey][] = []
    for (let i = 1; i <= numberOfBonds; i++) {
      const { voteAccount: voteAccount } = await createVoteAccountWithIdentity(
        provider,
        validatorIdentity
      )
      voteAndBonds.push([voteAccount, PublicKey.default])
    }

    const bondAuthority = Keypair.generate()
    signers.push(signer(bondAuthority))
    for (let i = 1; i <= numberOfBonds; i++) {
      const [voteAccount] = voteAndBonds[i - 1]
      const { instruction, bondAccount } = await initBondInstruction({
        program,
        configAccount,
        bondAuthority: bondAuthority.publicKey,
        cpmpe: Math.floor(Math.random() * 100),
        voteAccount,
        validatorIdentity,
      })
      tx.add(instruction)
      voteAndBonds[i - 1][1] = bondAccount
    }
    await waitForNextEpoch(provider.connection, 15)
    for (let i = 1; i <= numberOfBonds; i++) {
      const [voteAccount, bondAccount] = voteAndBonds[i - 1]
      const { instruction } = await initWithdrawRequestInstruction({
        program,
        bondAccount,
        configAccount,
        authority: bondAuthority,
        amount: 2 * LAMPORTS_PER_SOL,
        voteAccount,
      })
      tx.add(instruction)
    }
    expect(tx.instructions.length).toEqual(numberOfBonds * 2)
    const currentEpoch = Number(
      (await provider.connection.getEpochInfo()).epoch
    )
    await splitAndExecuteTx({
      connection: provider.connection,
      transaction: tx,
      signers,
      errMessage: 'Failed to init bonds and withdraw requests',
    })

    let withdrawRequestList = await findWithdrawRequests({
      program,
      epoch: currentEpoch,
    })
    expect(withdrawRequestList.length).toEqual(numberOfBonds)

    withdrawRequestList = await findWithdrawRequests({
      program,
      bond: voteAndBonds[0][1],
      voteAccount: voteAndBonds[0][0],
      epoch: currentEpoch,
    })
    expect(withdrawRequestList.length).toEqual(1)

    withdrawRequestList = await findWithdrawRequests({ program })
    expect(withdrawRequestList.length).toBeGreaterThanOrEqual(numberOfBonds)

    for (let i = 1; i <= numberOfBonds; i++) {
      const [voteAccount, bondAccount] = voteAndBonds[i - 1]
      withdrawRequestList = await findWithdrawRequests({
        program,
        bond: bondAccount,
      })
      expect(withdrawRequestList.length).toEqual(1)
      withdrawRequestList = await findWithdrawRequests({
        program,
        voteAccount,
      })
      expect(withdrawRequestList.length).toEqual(1)
    }
  })
})
