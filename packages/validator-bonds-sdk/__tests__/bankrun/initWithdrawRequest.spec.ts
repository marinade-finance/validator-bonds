import {
  Bond,
  Config,
  ValidatorBondsProgram,
  getBond,
  getConfig,
  getWithdrawRequest,
  initWithdrawRequestInstruction,
  withdrawRequestAddress,
} from '../../src'
import {
  BankrunExtendedProvider,
  initBankrunTest,
  warpToEpoch,
} from './bankrun'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import { checkAnchorErrorMessage, signer } from '../utils/helpers'

describe('Validator Bonds init withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    const { voteAccount, validatorIdentity: nodeIdentity } =
      await createVoteAccount(provider)
    validatorIdentity = nodeIdentity
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction(
      program,
      provider,
      config.publicKey,
      bondAuthority,
      voteAccount,
      validatorIdentity,
      123
    )
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
      checkAnchorErrorMessage(e, 6002, 'Invalid authority')
    }
  })

  it('init withdraw request bond authority', async () => {
    const { instruction, withdrawRequest } =
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

    expect(withdrawRequest).toEqual(withdrawRequestAddr)
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.bond).toEqual(bond.publicKey)
    expect(withdrawRequestData.bump).toEqual(bump)
    expect(withdrawRequestData.epoch).toEqual(epoch)
    expect(withdrawRequestData.requestedAmount).toEqual(LAMPORTS_PER_SOL)
    expect(withdrawRequestData.validatorVoteAccount).toEqual(
      bond.account.validatorVoteAccount
    )
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)
  })

  it('init withdraw request withdrawer validator identity authority', async () => {
    const rentWallet = await createUserAndFund(
      provider,
      Keypair.generate(),
      LAMPORTS_PER_SOL
    )

    const { instruction, withdrawRequest } =
      await initWithdrawRequestInstruction({
        program,
        bondAccount: bond.publicKey,
        authority: validatorIdentity,
        amount: 123,
        rentPayer: rentWallet.publicKey,
      })
    await provider.sendIx([validatorIdentity, rentWallet], instruction)

    const rentWalletInfo = await provider.connection.getAccountInfo(
      rentWallet.publicKey
    )
    const withdrawRequestInfo = await provider.connection.getAccountInfo(
      withdrawRequest
    )
    if (withdrawRequestInfo === null) {
      throw new Error(`Withdraw request account ${withdrawRequest} not found`)
    }
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        withdrawRequestInfo.data.length
      )
    expect(rentWalletInfo!.lamports).toEqual(LAMPORTS_PER_SOL - rentExempt)

    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.bond).toEqual(bond.publicKey)
    expect(withdrawRequestData.requestedAmount).toEqual(123)
    expect(withdrawRequestData.validatorVoteAccount).toEqual(
      bond.account.validatorVoteAccount
    )
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)
  })

  it('cannot init new withdraw request if there is one already', async () => {
    const { withdrawRequest } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
    })
    const [withdrawRequestAddr] = withdrawRequestAddress(
      bond.publicKey,
      program.programId
    )
    expect(withdrawRequest).toEqual(withdrawRequestAddr)

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
            `${withdrawRequest.toBase58()} and only one withdraw request per bond account may exist`
        )
        throw e
      }
    }
  })
})
