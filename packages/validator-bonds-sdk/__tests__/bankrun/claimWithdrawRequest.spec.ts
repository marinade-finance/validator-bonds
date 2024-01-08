import {
  Bond,
  Config,
  ValidatorBondsProgram,
  getBond,
  getConfig,
  getVoteAccount,
  getWithdrawRequest,
} from '../../src'
import {
  BankrunExtendedProvider,
  initBankrunTest,
  warpToEpoch,
  warpToNextEpoch,
} from './bankrun'
import {
  executeFundBondInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { claimWithdrawRequestInstruction } from '../../src/instructions/claimWithdrawRequest'
import { delegatedStakeAccount } from '../utils/staking'

describe('Validator Bonds claim withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs: 2,
    })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    const {
      bondAccount,
      validatorIdentity: nodeIdentity,
      bondAuthority: bondAuth,
      voteAccount: voteAcc,
    } = await executeInitBondInstruction(program, provider, config.publicKey)
    voteAccount = voteAcc
    console.log('voteAccount', voteAccount.toBase58())
    bondAuthority = bondAuth
    validatorIdentity = nodeIdentity
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('claim withdraw request with bond authority', async () => {
    const { stakeAccount, withdrawer: stakeAccountWithdrawer } =
      await delegatedStakeAccount({
        provider,
        lamports: 3 * LAMPORTS_PER_SOL,
        voteAccountToDelegate: voteAccount,
      })
    await warpToNextEpoch(provider)
    await executeFundBondInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      lamports: 3 * LAMPORTS_PER_SOL,
      stakeAccount,
      stakeAccountAuthority: stakeAccountWithdrawer,
    })
    const { withdrawRequest } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
    })
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.validatorVoteAccount).toEqual(voteAccount)
    await warpToNextEpoch(provider)

    const { instruction } = await claimWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)
  })
})
