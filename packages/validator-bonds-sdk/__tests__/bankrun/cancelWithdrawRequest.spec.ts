import {
  Bond,
  Errors,
  ValidatorBondsProgram,
  cancelWithdrawRequestInstruction,
  getBond,
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

import assert from 'assert'
import { pubkey } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds cancel withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  let validatorIdentity: Keypair
  let withdrawRequestAccount: PublicKey
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    const {
      bondAccount,
      validatorIdentity: nodeIdentity,
      bondAuthority: bondAuth,
    } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
    })
    bondAuthority = bondAuth
    validatorIdentity = nodeIdentity!
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
    ;({ withdrawRequestAccount } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
    }))
  })

  it('cancel withdraw request with bond authority', async () => {
    const rentCollector = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    let rentCollectorInfo = await provider.connection.getAccountInfo(
      pubkey(rentCollector)
    )
    expect(rentCollectorInfo).not.toBeNull()
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(LAMPORTS_PER_SOL)
    const withdrawRequestInfo = await provider.connection.getAccountInfo(
      withdrawRequestAccount
    )
    assert(withdrawRequestInfo !== null)
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        withdrawRequestInfo.data.length
      )

    const { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      bondAccount: bond.publicKey,
      authority: bondAuthority,
      rentCollector: pubkey(rentCollector),
    })
    await provider.sendIx([bondAuthority], instruction)
    await assertNotExist(provider, withdrawRequestAccount)

    rentCollectorInfo = await provider.connection.getAccountInfo(
      pubkey(rentCollector)
    )
    expect(rentCollectorInfo).not.toBeNull()
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(LAMPORTS_PER_SOL + rentExempt)
  })

  it('cancel withdraw request with validator identity', async () => {
    const { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      bondAccount: bond.publicKey,
      authority: validatorIdentity,
    })
    await provider.sendIx([validatorIdentity], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
  })

  it('cancel withdraw request sdk test', async () => {
    let {
      withdrawRequestAccount,
      validatorIdentity: valIdent,
      bondAuthority: bondIdent,
      bondAccount,
      voteAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount,
    })
    let { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
    })
    await provider.sendIx([bondIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
    ;({ withdrawRequestAccount, validatorIdentity: valIdent } =
      await executeNewWithdrawRequest({
        program,
        provider,
        configAccount,
      }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      authority: valIdent,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
    ;({
      withdrawRequestAccount,
      validatorIdentity: valIdent,
      bondAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      authority: valIdent,
      bondAccount,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
    ;({
      withdrawRequestAccount,
      bondAuthority: bondIdent,
      bondAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount,
    }))
    await provider.sendIx([bondIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
    ;({
      withdrawRequestAccount,
      validatorIdentity: valIdent,
      bondAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount,
      authority: valIdent,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
    ;({
      withdrawRequestAccount,
      validatorIdentity: valIdent,
      bondAccount,
      voteAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount,
      authority: valIdent,
      voteAccount,
    }))
    await provider.sendIx([valIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
    ;({
      withdrawRequestAccount,
      bondAuthority: bondIdent,
      voteAccount,
    } = await executeNewWithdrawRequest({
      program,
      provider,
      configAccount,
    }))
    ;({ instruction } = await cancelWithdrawRequestInstruction({
      program,
      configAccount,
      voteAccount,
    }))
    await provider.sendIx([bondIdent!], instruction)
    await assertNotExist(provider, withdrawRequestAccount)
  })

  it('cannot cancel withdraw request with wrong authority', async () => {
    const wrongAuthority = Keypair.generate()
    try {
      const { instruction } = await cancelWithdrawRequestInstruction({
        program,
        withdrawRequestAccount,
        bondAccount: bond.publicKey,
        authority: wrongAuthority.publicKey,
      })
      await provider.sendIx([wrongAuthority], instruction)
      throw new Error('failure; expected wrong authority')
    } catch (e) {
      verifyError(e, Errors, 6002, 'Invalid authority')
    }
    expect(
      provider.connection.getAccountInfo(withdrawRequestAccount)
    ).resolves.not.toBeNull()
  })

  it('withdraw request can be recreated when deleted', async () => {
    await executeCancelWithdrawRequestInstruction(
      program,
      provider,
      withdrawRequestAccount,
      bondAuthority
    )
    assertNotExist(provider, withdrawRequestAccount)
    warpToNextEpoch(provider)
    await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
    })
    expect(
      provider.connection.getAccountInfo(withdrawRequestAccount)
    ).resolves.not.toBeNull()

    await executeCancelWithdrawRequestInstruction(
      program,
      provider,
      withdrawRequestAccount,
      bondAuthority
    )
    assertNotExist(provider, withdrawRequestAccount)
  })
})
