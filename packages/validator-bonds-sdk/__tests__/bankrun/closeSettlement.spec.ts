import {
  Config,
  Errors,
  ValidatorBondsProgram,
  closeSettlementInstruction,
  fundSettlementInstruction,
  getConfig,
  getSettlement,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
  initBankrunTest,
  warpOffsetEpoch,
  warpToNextEpoch,
} from './bankrun'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
  getRentExemptStake,
} from '../utils/staking'
import { getRentExempt } from '../utils/helpers'
import assert from 'assert'
import { pubkey, signer } from '@marinade.finance/web3js-common'
import { checkErrorMessage, verifyError } from '@marinade.finance/anchor-common'

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
  let settlementEpoch: number
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
      }
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
    ;({ settlementAccount } = await executeInitSettlement({
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
    await createUserAndFund(provider, LAMPORTS_PER_SOL, pubkey(rentCollector))
    let rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey
    )
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(LAMPORTS_PER_SOL)
    const rentExemptSettlement = await getRentExempt(
      provider,
      settlementAccount
    )

    const { instruction } = await closeSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
    })

    await warpToBeClosable()
    await provider.sendIx([], instruction)
    assertNotExist(provider, settlementAccount)

    rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey
    )
    expect(rentCollectorInfo).not.toBeNull()
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(
      LAMPORTS_PER_SOL + rentExemptSettlement
    )
  })

  it('cannot close settlement when permitted rent collector does not match', async () => {
    const rentCollectorTest = await createUserAndFund(
      provider,
      LAMPORTS_PER_SOL
    )
    expect(pubkey(rentCollectorTest)).not.toEqual(rentCollector.publicKey)
    const { instruction } = await closeSettlementInstruction({
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
    const { instruction } = await closeSettlementInstruction({
      program,
      settlementAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error(
        'failure expected as settlement claim has not expired yet'
      )
    } catch (e) {
      verifyError(e, Errors, 6022, 'has not expired yet')
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

    const splitStakeRentPayer = await createUserAndFund(
      provider,
      LAMPORTS_PER_SOL
    )
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
      fundIx
    )

    const rentExemptStake = await getRentExemptStake(provider)
    expect(
      (await provider.connection.getAccountInfo(pubkey(splitStakeRentPayer)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL - rentExemptStake)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports
    ).toEqual(
      settlementData.maxTotalClaim.toNumber() +
        2 * rentExemptStake +
        config.minimumStakeLamports.toNumber()
    )

    const { instruction } = await closeSettlementInstruction({
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

    const { instruction: ixWrongStake } = await closeSettlementInstruction({
      program,
      settlementAccount,
      splitRentRefundAccount: pubkey(splitStakeAccount),
    })
    try {
      await provider.sendIx([], ixWrongStake)
      throw new Error('error expected; stake account is not deactivated')
    } catch (e) {
      expect(checkErrorMessage(e, 'insufficient funds')).toBeTruthy()
    }

    const { instruction: ixWrongCollector } = await closeSettlementInstruction({
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

    const { instruction: ixOk } = await closeSettlementInstruction({
      program,
      settlementAccount,
      splitRentRefundAccount: pubkey(stakeAccount),
      splitRentCollector: pubkey(splitStakeRentPayer),
    })
    await provider.sendIx([], ixOk)

    expect(
      (await provider.connection.getAccountInfo(pubkey(splitStakeRentPayer)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports
    ).toEqual(
      settlementData.maxTotalClaim.toNumber() +
        rentExemptStake +
        config.minimumStakeLamports.toNumber()
    )
  })

  async function warpToBeClosable() {
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
  }
})
