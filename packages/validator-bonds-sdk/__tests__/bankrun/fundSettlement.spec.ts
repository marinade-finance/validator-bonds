import {
  Config,
  Errors,
  U64_MAX,
  ValidatorBondsProgram,
  closeSettlementInstruction,
  fundSettlementInstruction,
  getConfig,
  getSettlement,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  bankrunExecuteIx,
  currentEpoch,
  delegateAndFund,
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
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  StakeStates,
  createBondsFundedStakeAccount,
  createSettlementFundedStakeAccount,
  createVoteAccount,
  getAndCheckStakeAccount,
  getRentExemptStake,
} from '../utils/staking'
import { pubkey, signer } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds fund settlement', () => {
  const epochsToClaimSettlement = 3
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let settlementEpoch: number
  let rentCollector: Keypair
  let rentExemptStake: number
  let stakeAccountMinimalAmount: number

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    rentExemptStake = await getRentExemptStake(provider)
  })

  beforeEach(async () => {
    const { configAccount, operatorAuthority: operatorAuth } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement,
      })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    operatorAuthority = operatorAuth
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      config: config.publicKey,
      voteAccount,
      validatorIdentity,
    }))
    settlementEpoch = await currentEpoch(provider)
    rentCollector = Keypair.generate()
    stakeAccountMinimalAmount =
      rentExemptStake + config.account.minimumStakeLamports.toNumber()
  })

  it('fund settlement fully with precise amount', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 10
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const splitRentPayer = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    const lamportsToFund1 = maxTotalClaim / 2
    const lamportsToFund2 =
      maxTotalClaim - lamportsToFund1 + 2 * stakeAccountMinimalAmount
    const stakeAccount1 =
      await createBondsFundedStakeAccountActivated(lamportsToFund1)
    const stakeAccountData =
      await provider.connection.getAccountInfo(stakeAccount1)
    expect(stakeAccountData?.lamports).toEqual(lamportsToFund1)
    let settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(0)

    const { instruction: ix1, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: stakeAccount1,
        splitStakeRentPayer: splitRentPayer,
      })
    await provider.sendIx(
      [signer(splitRentPayer), signer(splitStakeAccount), operatorAuthority],
      ix1
    )

    settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(
      lamportsToFund1 - stakeAccountMinimalAmount
    )
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)
    expect(
      (await provider.connection.getAccountInfo(pubkey(splitRentPayer)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount1))?.lamports
    ).toEqual(lamportsToFund1)
    await assertNotExist(provider, pubkey(splitStakeAccount))

    const stakeAccount2 =
      await createBondsFundedStakeAccountActivated(lamportsToFund2)
    const { instruction: ix2 } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount: stakeAccount2,
      splitStakeRentPayer: splitRentPayer,
      splitStakeAccount,
    })
    await provider.sendIx(
      [signer(splitRentPayer), signer(splitStakeAccount), operatorAuthority],
      ix2
    )

    settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(maxTotalClaim)
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)
    expect(
      (await provider.connection.getAccountInfo(pubkey(splitRentPayer)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount2))?.lamports
    ).toEqual(lamportsToFund2)
    await assertNotExist(provider, pubkey(splitStakeAccount))

    const stakeAccount3 = await createBondsFundedStakeAccountActivated(
      LAMPORTS_PER_SOL * 2
    )
    const { instruction: ix3 } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount: stakeAccount3,
      splitStakeRentPayer: splitRentPayer,
      splitStakeAccount,
    })
    const txLog = await bankrunExecuteIx(
      provider,
      [
        provider.wallet,
        signer(splitRentPayer),
        signer(splitStakeAccount),
        operatorAuthority,
      ],
      ix3
    )

    expect(
      txLog.logMessages.find(v => v.includes('already fully funded'))
    ).toBeDefined()
    settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(maxTotalClaim)
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)
    await assertNotExist(provider, pubkey(splitStakeAccount))
  })

  it('fund fully without split as not split-able', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 2
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const splitStakeRentPayer = await createUserAndFund(
      provider,
      LAMPORTS_PER_SOL
    )
    const lamportsToFund = maxTotalClaim + LAMPORTS_PER_SOL
    const stakeAccount =
      await createBondsFundedStakeAccountActivated(lamportsToFund)

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
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
      instruction
    )

    const settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(
      lamportsToFund - stakeAccountMinimalAmount
    )
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports
    ).toEqual(lamportsToFund)

    expect(
      (await provider.connection.getAccountInfo(pubkey(splitStakeRentPayer)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL)
    await assertNotExist(provider, pubkey(splitStakeAccount))
  })

  it('fund settlement with split', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 2
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const splitStakeRentPayer = await createUserAndFund(
      provider,
      LAMPORTS_PER_SOL
    )
    const lamportsToFund = maxTotalClaim + 3 * LAMPORTS_PER_SOL
    const stakeAccount =
      await createBondsFundedStakeAccountActivated(lamportsToFund)

    let [stakeAccountData] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated
    )

    const executionEpoch = await currentEpoch(provider)
    expect(stakeAccountData.Stake?.stake.delegation.deactivationEpoch).toEqual(
      U64_MAX
    )
    expect(stakeAccountData.Stake?.stake.delegation.activationEpoch).toEqual(
      executionEpoch - 1
    )

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
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
      instruction
    )

    const settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(maxTotalClaim)
    expect(settlementData.splitRentAmount).toEqual(rentExemptStake)
    expect(settlementData.splitRentCollector).toEqual(
      pubkey(splitStakeRentPayer)
    )
    expect(
      (await provider.connection.getAccountInfo(pubkey(splitStakeRentPayer)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL - rentExemptStake)
    const splitStakeAccountInfo = await provider.connection.getAccountInfo(
      pubkey(splitStakeAccount)
    )
    expect(splitStakeAccountInfo?.lamports).toEqual(
      lamportsToFund - maxTotalClaim - stakeAccountMinimalAmount
    )
    // stake account consist of what to be claimed + amount needed for existence a stake account + rent exempt to refund split payer
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports
    ).toEqual(maxTotalClaim + stakeAccountMinimalAmount + rentExemptStake)

    // stake account expected to be deactivated in next epoch
    await warpToNextEpoch(provider)
    const epochNow = await currentEpoch(provider)
    ;[stakeAccountData] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated
    )
    expect(stakeAccountData.Stake?.stake.delegation.deactivationEpoch).toEqual(
      epochNow - 1
    )
    expect(stakeAccountData.Stake?.stake.delegation.activationEpoch).toEqual(
      executionEpoch - 1
    )
  })

  it('fund settlement with bond funded account', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 2
    const { stakeAccount: bondsFundedStakeAccount } = await delegateAndFund({
      program,
      provider,
      voteAccount,
      lamports: maxTotalClaim,
      bond: bondAccount,
    })
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount: bondsFundedStakeAccount,
    })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      instruction
    )

    const settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(
      maxTotalClaim - stakeAccountMinimalAmount
    )
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)
    expect(
      (await provider.connection.getAccountInfo(bondsFundedStakeAccount))
        ?.lamports
    ).toEqual(maxTotalClaim)
    await assertNotExist(provider, pubkey(splitStakeAccount))
  })

  it('cannot fund closed settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      rentCollector: rentCollector.publicKey,
    })
    const { instruction: closeIx } = await closeSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
    })
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    await provider.sendIx([], closeIx)

    const { stakeAccount } = await delegateAndFund({
      program,
      provider,
      voteAccount,
      lamports: 3 * LAMPORTS_PER_SOL,
      bond: bondAccount,
    })
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount,
        configAccount: config.publicKey,
        bondAccount,
        operatorAuthority,
        voteAccount,
      })
    try {
      await provider.sendIx(
        [signer(splitStakeAccount), operatorAuthority],
        fundIx
      )
      throw new Error('cannot fund closed settlement')
    } catch (e) {
      // 3012. Error Message: The program expected this account to be already initialized.
      expect(
        (e as Error).message.includes('custom program error: 0xbc4')
      ).toBeTruthy()
    }
  })

  it('cannot fund settlement with wrong authority', async () => {
    const wrongOperator = Keypair.generate()
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      rentCollector: rentCollector.publicKey,
    })
    const { stakeAccount } = await delegateAndFund({
      program,
      provider,
      voteAccount,
      lamports: 3 * LAMPORTS_PER_SOL,
      bond: bondAccount,
    })

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
      operatorAuthority: wrongOperator,
    })
    try {
      await provider.sendIx(
        [wrongOperator, signer(splitStakeAccount)],
        instruction
      )
      throw new Error('cannot fund as wrong authority')
    } catch (e) {
      verifyError(e, Errors, 6003, 'operator authority signature')
    }
    assertNotExist(provider, pubkey(splitStakeAccount))
    expect(
      (await getSettlement(program, settlementAccount)).lamportsFunded
    ).toEqual(0)
  })

  it('cannot fund already funded', async () => {
    const maxTotalClaim = 3 * LAMPORTS_PER_SOL
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })
    const { stakeAccount } = await delegateAndFund({
      program,
      provider,
      voteAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      bond: bondAccount,
    })

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
      operatorAuthority,
    })
    await provider.sendIx(
      [operatorAuthority, signer(splitStakeAccount)],
      instruction
    )
    const beingFunded = 2 * LAMPORTS_PER_SOL - stakeAccountMinimalAmount
    expect(
      (await getSettlement(program, settlementAccount)).lamportsFunded
    ).toEqual(beingFunded)
    assertNotExist(provider, pubkey(splitStakeAccount))

    await warpToNextEpoch(provider)
    try {
      await provider.sendIx(
        [operatorAuthority, signer(splitStakeAccount)],
        instruction
      )
      throw new Error('cannot fund as already funded')
    } catch (e) {
      verifyError(e, Errors, 6028, 'has been already funded')
    }
    assertNotExist(provider, pubkey(splitStakeAccount))
    expect(
      (await getSettlement(program, settlementAccount)).lamportsFunded
    ).toEqual(beingFunded)

    const manuallyCreated = await createSettlementFundedStakeAccountActivated(
      maxTotalClaim * 20,
      settlementAccount
    )
    const { instruction: ixManual, splitStakeAccount: splitManual } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: manuallyCreated,
        operatorAuthority,
        bondAccount,
        configAccount: config.publicKey,
        splitStakeAccount: splitStakeAccount,
      })

    try {
      await provider.sendIx([operatorAuthority, signer(splitManual)], ixManual)
      throw new Error('cannot fund as already funded')
    } catch (e) {
      verifyError(e, Errors, 6028, 'has been already funded')
    }
    assertNotExist(provider, pubkey(splitManual))
    expect(
      (await getSettlement(program, settlementAccount)).lamportsFunded
    ).toEqual(beingFunded)
  })

  async function createBondsFundedStakeAccountActivated(
    lamports: number
  ): Promise<PublicKey> {
    const sa = await createBondsFundedStakeAccount({
      program,
      provider,
      voteAccount,
      lamports,
      configAccount: config.publicKey,
    })
    await warpToNextEpoch(provider)
    return sa
  }

  async function createSettlementFundedStakeAccountActivated(
    lamports: number,
    settlementAccount: PublicKey
  ): Promise<PublicKey> {
    const sa = await createSettlementFundedStakeAccount({
      program,
      provider,
      voteAccount,
      lamports,
      configAccount: config.publicKey,
      settlementAccount: settlementAccount,
    })
    await warpToNextEpoch(provider)
    return sa
  }
})
