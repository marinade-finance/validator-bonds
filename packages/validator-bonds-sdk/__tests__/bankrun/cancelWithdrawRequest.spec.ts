import {
  Bond,
  Config,
  ValidatorBondsProgram,
  cancelWithdrawRequestInstruction,
  getBond,
  getConfig,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  initBankrunTest,
  warpToEpoch,
  warpToNextEpoch,
} from './bankrun'
import {
  createUserAndFund,
  executeCancelWithdrawRequestInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
  executeNewWithdrawRequest,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { checkAnchorErrorMessage } from '../utils/helpers'
import assert from 'assert'

describe('Validator Bonds cancel withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
  let withdrawRequest: PublicKey
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
    const {
      bondAccount,
      validatorIdentity: nodeIdentity,
      bondAuthority: bondAuth,
    } = await executeInitBondInstruction(program, provider, config.publicKey)
    bondAuthority = bondAuth
    validatorIdentity = nodeIdentity
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
    ;({ withdrawRequest } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
    }))
    expect(
      provider.connection.getAccountInfo(withdrawRequest)
    ).resolves.not.toBeNull()
  })

  it('cancel withdraw request with bond authority', async () => {
    const rentCollector = await createUserAndFund(
      provider,
      undefined,
      LAMPORTS_PER_SOL
    )
    let rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey
    )
    expect(rentCollectorInfo).not.toBeNull()
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(LAMPORTS_PER_SOL)
    const withdrawRequestInfo = await provider.connection.getAccountInfo(
      withdrawRequest
    )
    assert(withdrawRequestInfo !== null)
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        withdrawRequestInfo.data.length
      )

    const { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
      bondAccount: bond.publicKey,
      authority: bondAuthority,
      rentCollector: rentCollector.publicKey,
    })
    await provider.sendIx([bondAuthority], instruction)
    await assertNotExist(provider, withdrawRequest)

    rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey
    )
    expect(rentCollectorInfo).not.toBeNull()
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(LAMPORTS_PER_SOL + rentExempt)
  })

  it('cancel withdraw request with validator identity', async () => {
    const { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
      bondAccount: bond.publicKey,
      authority: validatorIdentity,
    })
    await provider.sendIx([validatorIdentity], instruction)
    await assertNotExist(provider, withdrawRequest)
  })

  it('cancel withdraw request sdk test', async () => {
    let {
      withdrawRequest,
      validatorIdentity: valIdent,
      bondAuthority: bondIdent,
      bondAccount,
      voteAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount: config.publicKey,
    })
    let { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
    })
    await provider.sendIx([bondIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
    ;({ withdrawRequest, validatorIdentity: valIdent } =
      await executeNewWithdrawRequest({
        program,
        provider,
        configAccount: config.publicKey,
      }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
      authority: valIdent,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
    ;({
      withdrawRequest,
      validatorIdentity: valIdent,
      bondAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount: config.publicKey,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
      authority: valIdent,
      bondAccount,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
    ;({
      withdrawRequest,
      bondAuthority: bondIdent,
      bondAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount: config.publicKey,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount: config.publicKey,
    }))
    await provider.sendIx([bondIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
    ;({
      withdrawRequest,
      validatorIdentity: valIdent,
      bondAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount: config.publicKey,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount: config.publicKey,
      authority: valIdent,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
    ;({
      withdrawRequest,
      validatorIdentity: valIdent,
      bondAccount,
      voteAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount: config.publicKey,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount: config.publicKey,
      authority: valIdent,
      validatorVoteAccount: voteAccount,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
    ;({
      withdrawRequest,
      bondAuthority: bondIdent,
      voteAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount: config.publicKey,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      configAccount: config.publicKey,
      validatorVoteAccount: voteAccount,
    }))
    await provider.sendIx([bondIdent!], instruction)
    await assertNotExist(provider, withdrawRequest)
  })

  it('cannot cancel withdraw request with wrong authority', async () => {
    const wrongAuthority = Keypair.generate()
    try {
      const { instruction } = await cancelWithdrawRequestInstruction({
        program,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        authority: wrongAuthority.publicKey,
      })
      await provider.sendIx([wrongAuthority], instruction)
      throw new Error('failure; expected wrong authority')
    } catch (e) {
      checkAnchorErrorMessage(e, 6002, 'Invalid authority')
    }
    expect(
      provider.connection.getAccountInfo(withdrawRequest)
    ).resolves.not.toBeNull()
  })

  it('withdraw request can be recreated when deleted', async () => {
    await executeCancelWithdrawRequestInstruction(
      program,
      provider,
      withdrawRequest,
      bondAuthority
    )
    assertNotExist(provider, withdrawRequest)
    warpToNextEpoch(provider)
    await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
    })
    expect(
      provider.connection.getAccountInfo(withdrawRequest)
    ).resolves.not.toBeNull()

    await executeCancelWithdrawRequestInstruction(
      program,
      provider,
      withdrawRequest,
      bondAuthority
    )
    assertNotExist(provider, withdrawRequest)
  })
})
