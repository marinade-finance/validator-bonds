import {
  Bond,
  Errors,
  ValidatorBondsProgram,
  getBond,
  getWithdrawRequest,
  initWithdrawRequestInstruction,
  withdrawRequestAddress,
} from '../../src'
import {
  BankrunExtendedProvider,
  warpToEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import {
  createUserAndFund,
  pubkey,
  signer,
} from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds init withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
  let startUpEpoch: number

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    const startUpEpochPlus = Math.floor(Math.random() * 100) + 100
    const currentEpoch = Number(
      (await provider.context.banksClient.getClock()).epoch
    )
    startUpEpoch = currentEpoch + startUpEpochPlus
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    const { voteAccount, validatorIdentity: nodeIdentity } =
      await createVoteAccount({ provider })
    validatorIdentity = nodeIdentity
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      bondAuthority,
      voteAccount,
      validatorIdentity,
    })
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('cannot init withdraw request with wrong authority', async () => {
    try {
      const randomAuthority = Keypair.generate()
      const { instruction } = await initWithdrawRequestInstruction({
        program,
        bondAccount: bond.publicKey,
        authority: randomAuthority,
        amount: LAMPORTS_PER_SOL,
      })
      await provider.sendIx([signer(randomAuthority)], instruction)
      throw new Error('failure; expected wrong authority')
    } catch (e) {
      verifyError(e, Errors, 6002, 'Invalid authority')
    }
  })

  it('init withdraw request bond authority', async () => {
    const { instruction, withdrawRequestAccount } =
      await initWithdrawRequestInstruction({
        program,
        bondAccount: bond.publicKey,
        authority: bondAuthority,
        amount: LAMPORTS_PER_SOL,
      })
    await provider.sendIx([signer(bondAuthority)], instruction)

    const [withdrawRequestAddr, bump] = withdrawRequestAddress(
      bond.publicKey,
      program.programId
    )
    const epoch = Number((await provider.context.banksClient.getClock()).epoch)

    expect(withdrawRequestAccount).toEqual(withdrawRequestAddr)
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.bond).toEqual(bond.publicKey)
    expect(withdrawRequestData.bump).toEqual(bump)
    expect(withdrawRequestData.epoch).toEqual(epoch)
    expect(withdrawRequestData.requestedAmount).toEqual(LAMPORTS_PER_SOL)
    expect(withdrawRequestData.voteAccount).toEqual(bond.account.voteAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)

    const withdrawRequestAccountInfo = await provider.connection.getAccountInfo(
      withdrawRequestAccount
    )
    console.log(
      'withdraw request account length',
      withdrawRequestAccountInfo?.data.byteLength
    )
    // not account change size expected
    expect(withdrawRequestAccountInfo?.data.byteLength).toEqual(192)
  })

  it('init withdraw request withdrawer validator identity authority', async () => {
    const rentWallet = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    const { instruction, withdrawRequestAccount } =
      await initWithdrawRequestInstruction({
        program,
        bondAccount: bond.publicKey,
        authority: validatorIdentity,
        amount: 123,
        rentPayer: pubkey(rentWallet),
      })
    await provider.sendIx([validatorIdentity, signer(rentWallet)], instruction)

    const rentWalletInfo = await provider.connection.getAccountInfo(
      pubkey(rentWallet)
    )
    const withdrawRequestInfo = await provider.connection.getAccountInfo(
      withdrawRequestAccount
    )
    if (withdrawRequestInfo === null) {
      throw new Error(
        `Withdraw request account ${withdrawRequestAccount} not found`
      )
    }
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        withdrawRequestInfo.data.length
      )
    expect(rentWalletInfo!.lamports).toEqual(LAMPORTS_PER_SOL - rentExempt)

    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.bond).toEqual(bond.publicKey)
    expect(withdrawRequestData.requestedAmount).toEqual(123)
    expect(withdrawRequestData.voteAccount).toEqual(bond.account.voteAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)
  })

  it('cannot init new withdraw request if there is one already', async () => {
    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        bondAccount: bond.publicKey,
        validatorIdentity,
      })
    const [withdrawRequestAddr] = withdrawRequestAddress(
      bond.publicKey,
      program.programId
    )
    expect(withdrawRequestAccount).toEqual(withdrawRequestAddr)

    try {
      const { instruction } = await initWithdrawRequestInstruction({
        program,
        bondAccount: bond.publicKey,
        authority: validatorIdentity,
        amount: 123,
      })
      await provider.sendIx([validatorIdentity], instruction)
      throw new Error('failure; expected withdraw request already exists')
    } catch (e) {
      if (!(e as Error).message.includes('custom program error: 0x0')) {
        console.error(
          'Expected existence of the init withdraw request account ' +
            `${withdrawRequestAccount.toBase58()} and only one withdraw request per bond account may exist`
        )
        throw e
      }
    }
  })
})
