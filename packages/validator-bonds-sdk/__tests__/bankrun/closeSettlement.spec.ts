import {
  Config,
  Errors,
  ValidatorBondsProgram,
  closeSettlementV2Instruction,
  fundSettlementInstruction,
  getConfig,
  getRentExemptStake,
  getSettlement,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '../utils/staking'
import { getRentExempt, executeTxWithError } from '../utils/helpers'
import assert from 'assert'
import {
  createUserAndFund,
  pubkey,
  signer,
} from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds close settlement', () => {
  const epochsToClaimSettlement = 1
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let config: Config
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let settlementAccount: PublicKey
  let settlementClaimsAccount: PublicKey
  let settlementEpoch: bigint
  let rentCollector: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
      },
    ))
    config = await getConfig(program, configAccount)
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    settlementEpoch = await currentEpoch(provider)
    rentCollector = Keypair.generate()
    ;({ settlementAccount, settlementClaimsAccount } =
      await executeInitSettlement({
        configAccount,
        program,
        provider,
        voteAccount,
        operatorAuthority,
        currentEpoch: settlementEpoch,
        rentCollector: rentCollector.publicKey,
      }))
    const settlementData = await getSettlement(program, settlementAccount)
    expect(bondAccount).toEqual(settlementData.bond)
  })

  it('close settlement', async () => {
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: rentCollector,
    })
    let rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey,
    )
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(LAMPORTS_PER_SOL)
    const rentExemptSettlement = await getRentExempt(
      provider,
      settlementAccount,
    )
    const rentExemptSettlementClaims = await getRentExempt(
      provider,
      settlementClaimsAccount,
    )

    const { instruction } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
    })

    await warpToBeClosable()
    await provider.sendIx([], instruction)
    await assertNotExist(provider, settlementAccount)

    rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey,
    )
    expect(rentCollectorInfo).not.toBeNull()
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(
      LAMPORTS_PER_SOL + rentExemptSettlement + rentExemptSettlementClaims,
    )
  })

  it('cannot close settlement when permitted rent collector does not match', async () => {
    const rentCollectorTest = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
    expect(pubkey(rentCollectorTest)).not.toEqual(rentCollector.publicKey)
    const { instruction } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      rentCollector: pubkey(rentCollectorTest),
    })

    await warpToBeClosable()
    try {
      await provider.sendIx([], instruction)
    } catch (e) {
      verifyError(e, Errors, 6043, 'does not match permitted rent collector')
    }
  })

  it('cannot close settlement when not expired', async () => {
    const { instruction } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; settlement has not expired yet')
    } catch (e) {
      verifyError(e, Errors, 6022, 'Settlement has not expired yet')
    }
  })

  it('close funded settlement with split', async () => {
    const settlementData = await getSettlement(program, settlementAccount)
    const lamportsToFund =
      settlementData.maxTotalClaim.toNumber() + 6 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: lamportsToFund,
    })
    await warpToNextEpoch(provider) // activate stake account

    const splitStakeRentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount,
        splitStakeRentPayer,
      })
    await provider.sendIx(
      [
        signer(splitStakeRentPayer),
        signer(splitStakeAccount),
        operatorAuthority,
      ],
      fundIx,
    )

    const rentExemptStake = await getRentExemptStake(provider)
    expect(
      (await provider.connection.getAccountInfo(pubkey(splitStakeRentPayer)))
        ?.lamports,
    ).toEqual(LAMPORTS_PER_SOL - rentExemptStake)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports,
    ).toEqual(
      settlementData.maxTotalClaim.toNumber() +
        2 * rentExemptStake +
        config.minimumStakeLamports.toNumber(),
    )

    const { instruction } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      splitRentRefundAccount: rentCollector.publicKey,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('error expected; settlement has not expired yet')
    } catch (e) {
      verifyError(e, Errors, 6022, 'has not expired yet')
    }

    await warpToBeClosable()
    try {
      await provider.sendIx([], instruction)
      throw new Error('error expected; wrong split stake account')
    } catch (e) {
      verifyError(e, Errors, 6006, 'not owned by the stake account')
    }

    const { instruction: ixWrongStake } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      splitRentRefundAccount: pubkey(splitStakeAccount),
    })
    await executeTxWithError(
      provider,
      '',
      'insufficient funds',
      [],
      ixWrongStake,
    )

    const { instruction: ixWrongCollector } =
      await closeSettlementV2Instruction({
        program,
        settlementAccount,
        splitRentRefundAccount: pubkey(stakeAccount),
        splitRentCollector: provider.walletPubkey,
      })
    try {
      await provider.sendIx([], ixWrongCollector)
      throw new Error('error expected; wrong rent collector')
    } catch (e) {
      verifyError(e, Errors, 6043, 'does not match permitted rent collector')
    }

    const { instruction: ixOk } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      splitRentRefundAccount: pubkey(stakeAccount),
      splitRentCollector: pubkey(splitStakeRentPayer),
    })
    await provider.sendIx([], ixOk)

    expect(
      (await provider.connection.getAccountInfo(pubkey(splitStakeRentPayer)))
        ?.lamports,
    ).toEqual(LAMPORTS_PER_SOL)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports,
    ).toEqual(
      settlementData.maxTotalClaim.toNumber() +
        rentExemptStake +
        config.minimumStakeLamports.toNumber(),
    )
  })

  async function warpToBeClosable() {
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
  }
})
