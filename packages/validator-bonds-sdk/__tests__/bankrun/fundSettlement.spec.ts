import {
  Errors,
  ValidatorBondsProgram,
  closeSettlementV2Instruction,
  fundSettlementInstruction,
  getConfig,
  getSettlement,
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
  deserializeStakeState,
  getRentExemptStake,
  Config,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  bankrunExecuteIx,
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  SystemProgram,
} from '@solana/web3.js'
import {
  StakeStates,
  authorizeStakeAccount,
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createVoteAccount,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import {
  U64_MAX,
  createUserAndFund,
  pubkey,
  signer,
} from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest, delegateAndFund } from './bankrun'

describe('Validator Bonds fund settlement', () => {
  const epochsToClaimSettlement = 3
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let config: Config
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
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
    settlementEpoch = await currentEpoch(provider)
    rentCollector = Keypair.generate()
    stakeAccountMinimalAmount =
      rentExemptStake + config.minimumStakeLamports.toNumber()
  })

  it('fund settlement fully with precise amount', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 10
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const splitRentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
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
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const splitStakeRentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
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
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim,
    })

    const splitStakeRentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
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
      bondAccount,
      lamports: maxTotalClaim,
    })
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
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

  it('fund settlement with deactivated stake', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 2
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      maxTotalClaim,
    })
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      voteAccountToDelegate: voteAccount,
    })
    const deactivateIx = StakeProgram.deactivate({
      stakePubkey: stakeAccount,
      authorizedPubkey: staker.publicKey,
    })
    await provider.sendIx([staker], deactivateIx)
    const [bondAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const [settlementAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId
    )
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: bondAuth,
      withdrawer: bondAuth,
    })
    let stakeAccountInfo =
      await provider.connection.getAccountInfo(stakeAccount)
    let stakeAccountData = deserializeStakeState(stakeAccountInfo?.data)
    expect(stakeAccountData.Stake?.meta.authorized.staker).toEqual(bondAuth)
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(bondAuth)

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
    })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      instruction
    )
    const settlementData = await getSettlement(program, settlementAccount)
    // nothing funded as the lamports of the stake account is exactly min lamports for stake account (1 SOL) + rent exempt
    expect(settlementData.lamportsFunded).toEqual(0)
    await assertNotExist(provider, pubkey(splitStakeAccount))
    stakeAccountInfo = await provider.connection.getAccountInfo(stakeAccount)
    stakeAccountData = deserializeStakeState(stakeAccountInfo?.data)
    expect(stakeAccountData.Stake?.meta.authorized.staker).toEqual(
      settlementAuth
    )
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(bondAuth)
  })

  it('cannot fund closed settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      rentCollector: rentCollector.publicKey,
    })
    const { instruction: closeIx } = await closeSettlementV2Instruction({
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
      bondAccount,
      lamports: 3 * LAMPORTS_PER_SOL,
    })
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount,
        configAccount,
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
      configAccount,
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
      bondAccount,
      lamports: 3 * LAMPORTS_PER_SOL,
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
      configAccount,
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
      bondAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
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
        configAccount,
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

  // Verification that fund settlement uses the non-delegated part of the stake account to be funded
  // The split account is left funded in Bond and "possibly" is fully delegated
  it('fund settlement with small amount not-fully delegated stake account', async () => {
    const maxTotalClaim = 1 * LAMPORTS_PER_SOL
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      maxTotalClaim,
    })

    // stake account big enough to be split to compare to maxTotalClaim
    const stakedLamports = 1000 * LAMPORTS_PER_SOL
    const stakeAccount =
      await createBondsFundedStakeAccountActivated(stakedLamports)
    // just adding small portion of SOLs on top of the fully activated amount
    const additionalSolTransfer = LAMPORTS_PER_SOL - 3
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: stakeAccount,
      lamports: additionalSolTransfer,
    })
    await provider.sendIx([], transferIx)
    let stakeAccountData =
      await provider.connection.getAccountInfo(stakeAccount)
    expect(stakeAccountData?.lamports).toEqual(
      stakedLamports + additionalSolTransfer
    )
    let stakeState = (await getAndCheckStakeAccount(provider, stakeAccount))[0]
    expect(stakeState.Stake!.stake.delegation.stake).toEqual(
      stakedLamports - rentExemptStake
    )

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount: stakeAccount,
    })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      instruction
    )

    stakeAccountData = await provider.connection.getAccountInfo(stakeAccount)
    stakeState = (await getAndCheckStakeAccount(provider, stakeAccount))[0]
    const splitStakeAccountData = await provider.connection.getAccountInfo(
      pubkey(splitStakeAccount)
    )
    // funded stake account has to have enough sol to fund the settlement, i.e., maxTotalClaim
    // then there has to be enough lamports after withdrawing all claiming that the stake account may still exist
    // then there is left rent exempt lamports to be returned to the payer of rent for splitting stake account
    expect(stakeAccountData?.lamports).toEqual(
      maxTotalClaim +
        config.minimumStakeLamports.toNumber() +
        2 * rentExemptStake
    )
    // as the split uses the original stake account then the non-delegated lamports should be available
    // in the settlement funded stake account
    // for the stake amount is not calculated the rent-exempt lamports for particular stake account
    expect(stakeState.Stake!.stake.delegation.stake).toEqual(
      maxTotalClaim +
        config.minimumStakeLamports.toNumber() +
        rentExemptStake -
        additionalSolTransfer
    )
    // check if split stake mount matches what was original in stake account
    // minus what was funded to the settlement
    // + rent exempt amount that was added on top of original amount by split rent payer wallet
    expect(splitStakeAccountData?.lamports).toEqual(
      stakedLamports +
        additionalSolTransfer -
        maxTotalClaim -
        config.minimumStakeLamports.toNumber() -
        rentExemptStake
    )
    // check the stake account is delegated to settlement
    const [bondsAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    expect(stakeState.Stake!.meta.authorized.staker).toEqual(
      settlementStakerAuthority(settlementAccount, program.programId)[0]
    )
    expect(stakeState.Stake!.meta.authorized.withdrawer).toEqual(bondsAuthority)
    // all lamports are delegated in split stake account (except of rent exempt lamports)
    const [splitStakeState] = await getAndCheckStakeAccount(
      provider,
      pubkey(splitStakeAccount),
      StakeStates.Delegated
    )
    expect(splitStakeState.Stake!.stake.delegation.stake).toEqual(
      (splitStakeAccountData?.lamports ?? 0) - rentExemptStake
    )
    // split stake account is funded to bond
    expect(splitStakeState.Stake!.meta.authorized.staker).toEqual(
      bondsAuthority
    )
    expect(splitStakeState.Stake!.meta.authorized.withdrawer).toEqual(
      bondsAuthority
    )
  })

  it.each([50, 0.5, 0.1])(
    'fund settlement non-delegated split: %d',
    async totalClaim => {
      const maxTotalClaim = totalClaim * LAMPORTS_PER_SOL
      const { settlementAccount } = await executeInitSettlement({
        configAccount,
        program,
        provider,
        voteAccount,
        operatorAuthority,
        currentEpoch: settlementEpoch,
        maxTotalClaim,
      })

      const lamportsToFund = 4444 * LAMPORTS_PER_SOL
      const stakeAccount =
        await createBondsFundedStakeAccountActivated(lamportsToFund)
      let stakeAccountData =
        await provider.connection.getAccountInfo(stakeAccount)
      expect(stakeAccountData?.lamports).toEqual(lamportsToFund)
      // adding some more lamports to stake account that are not delegated
      // when the amount of non-delegated lamports is bigger
      const stakeAccountTransferredLamports =
        maxTotalClaim + rentExemptStake + 1
      const transferIx = SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: stakeAccount,
        lamports: stakeAccountTransferredLamports,
      })
      await provider.sendIx([], transferIx)
      await getAndCheckStakeAccount(
        provider,
        stakeAccount,
        StakeStates.Delegated
      )
      stakeAccountData = await provider.connection.getAccountInfo(stakeAccount)
      expect(stakeAccountData?.lamports).toEqual(
        lamportsToFund + stakeAccountTransferredLamports
      )

      let settlementData = await getSettlement(program, settlementAccount)
      expect(settlementData.lamportsFunded).toEqual(0)

      const { instruction, splitStakeAccount } =
        await fundSettlementInstruction({
          program,
          settlementAccount,
          stakeAccount: stakeAccount,
        })
      await provider.sendIx(
        [signer(splitStakeAccount), operatorAuthority],
        instruction
      )

      settlementData = await getSettlement(program, settlementAccount)
      stakeAccountData = await provider.connection.getAccountInfo(stakeAccount)
      const splitStakeAccountData = await provider.connection.getAccountInfo(
        pubkey(splitStakeAccount)
      )

      expect(stakeAccountData?.lamports).toEqual(
        maxTotalClaim +
          2 * rentExemptStake + // rent for stake account + for returning rent exempt for split stake account
          config.minimumStakeLamports.toNumber()
      )
      expect(splitStakeAccountData?.lamports).toEqual(
        lamportsToFund +
          stakeAccountTransferredLamports -
          maxTotalClaim -
          config.minimumStakeLamports.toNumber() -
          rentExemptStake
      )
      expect(settlementData.lamportsFunded).toEqual(maxTotalClaim)
    }
  )

  it.each([50, 0.5, 0.1])(
    'fund settlement minimum delegated amount: %d',
    async totalClaim => {
      const maxTotalClaim = totalClaim * LAMPORTS_PER_SOL
      const { settlementAccount } = await executeInitSettlement({
        configAccount,
        program,
        provider,
        voteAccount,
        operatorAuthority,
        currentEpoch: settlementEpoch,
        maxTotalClaim,
      })

      const lamportsToFund =
        config.minimumStakeLamports.toNumber() + rentExemptStake
      const stakeAccount =
        await createBondsFundedStakeAccountActivated(lamportsToFund)
      let stakeAccountData =
        await provider.connection.getAccountInfo(stakeAccount)
      expect(stakeAccountData?.lamports).toEqual(lamportsToFund)
      const stakeAccountTransferredLamports = 500 * LAMPORTS_PER_SOL
      const transferIx = SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: stakeAccount,
        lamports: stakeAccountTransferredLamports,
      })
      await provider.sendIx([], transferIx)
      await getAndCheckStakeAccount(
        provider,
        stakeAccount,
        StakeStates.Delegated
      )
      stakeAccountData = await provider.connection.getAccountInfo(stakeAccount)
      expect(stakeAccountData?.lamports).toEqual(
        lamportsToFund + stakeAccountTransferredLamports
      )

      let settlementData = await getSettlement(program, settlementAccount)
      expect(settlementData.lamportsFunded).toEqual(0)

      const { instruction, splitStakeAccount } =
        await fundSettlementInstruction({
          program,
          settlementAccount,
          stakeAccount: stakeAccount,
        })
      await provider.sendIx(
        [signer(splitStakeAccount), operatorAuthority],
        instruction
      )

      settlementData = await getSettlement(program, settlementAccount)
      stakeAccountData = await provider.connection.getAccountInfo(stakeAccount)
      const splitStakeAccountData = await provider.connection.getAccountInfo(
        pubkey(splitStakeAccount)
      )

      expect(stakeAccountData?.lamports).toEqual(
        maxTotalClaim +
          2 * rentExemptStake + // rent for stake account + for returning rent exempt for split stake account
          config.minimumStakeLamports.toNumber()
      )
      expect(splitStakeAccountData?.lamports).toEqual(
        lamportsToFund +
          stakeAccountTransferredLamports -
          maxTotalClaim -
          config.minimumStakeLamports.toNumber() -
          rentExemptStake
      )
      expect(settlementData.lamportsFunded).toEqual(maxTotalClaim)
      await getAndCheckStakeAccount(
        provider,
        pubkey(splitStakeAccount),
        StakeStates.Delegated
      )
    }
  )

  it('double fund settlement minimum delegated amount', async () => {
    const maxTotalClaim = 50 * LAMPORTS_PER_SOL
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      maxTotalClaim,
    })
    let settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(0)

    // 1st stake account
    const lamportsToFund =
      config.minimumStakeLamports.toNumber() + rentExemptStake
    const stakeAccount1 =
      await createBondsFundedStakeAccountActivated(lamportsToFund)
    let stakeAccountData1 =
      await provider.connection.getAccountInfo(stakeAccount1)
    expect(stakeAccountData1?.lamports).toEqual(lamportsToFund)
    const stakeAccountTransferredLamports1 = 10 * LAMPORTS_PER_SOL
    const transferIx1 = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: stakeAccount1,
      lamports: stakeAccountTransferredLamports1,
    })
    await provider.sendIx([], transferIx1)
    await getAndCheckStakeAccount(
      provider,
      stakeAccount1,
      StakeStates.Delegated
    )
    stakeAccountData1 = await provider.connection.getAccountInfo(stakeAccount1)
    expect(stakeAccountData1?.lamports).toEqual(
      lamportsToFund + stakeAccountTransferredLamports1
    )

    // 2nd stake account
    const stakeAccount2 =
      await createBondsFundedStakeAccountActivated(lamportsToFund)
    let stakeAccountData2 =
      await provider.connection.getAccountInfo(stakeAccount2)
    expect(stakeAccountData2?.lamports).toEqual(lamportsToFund)
    const stakeAccountTransferredLamports2 = 100 * LAMPORTS_PER_SOL
    const transferIx2 = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: stakeAccount2,
      lamports: stakeAccountTransferredLamports2,
    })
    await provider.sendIx([], transferIx2)
    await getAndCheckStakeAccount(
      provider,
      stakeAccount2,
      StakeStates.Delegated
    )
    stakeAccountData2 = await provider.connection.getAccountInfo(stakeAccount2)
    expect(stakeAccountData2?.lamports).toEqual(
      lamportsToFund + stakeAccountTransferredLamports2
    )

    const { instruction: ixFund1, splitStakeAccount: split1 } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: stakeAccount1,
      })
    await provider.sendIx([signer(split1), operatorAuthority], ixFund1)
    assertNotExist(provider, pubkey(split1))
    settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(
      stakeAccountTransferredLamports1
    )

    const { instruction: ixFund2, splitStakeAccount: split2 } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: stakeAccount2,
      })
    await provider.sendIx([signer(split2), operatorAuthority], ixFund2)

    settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(maxTotalClaim)

    stakeAccountData1 = await provider.connection.getAccountInfo(stakeAccount1)
    stakeAccountData2 = await provider.connection.getAccountInfo(stakeAccount2)
    const splitStakeAccountData2 = await provider.connection.getAccountInfo(
      pubkey(split2)
    )

    expect(stakeAccountData1?.lamports).toEqual(
      stakeAccountTransferredLamports1 +
        rentExemptStake + // no split, just rent for stake account
        config.minimumStakeLamports.toNumber()
    )
    expect(stakeAccountData2?.lamports).toEqual(
      maxTotalClaim -
        stakeAccountTransferredLamports1 +
        2 * rentExemptStake + // rent for stake account + for returning rent exempt for split stake account
        config.minimumStakeLamports.toNumber()
    )
    expect(splitStakeAccountData2?.lamports).toEqual(
      stakeAccountTransferredLamports2 -
        (maxTotalClaim - stakeAccountTransferredLamports1)
    )
    await getAndCheckStakeAccount(
      provider,
      pubkey(split2),
      StakeStates.Delegated
    )
  })

  async function createBondsFundedStakeAccountActivated(
    lamports: number
  ): Promise<PublicKey> {
    const sa = await createBondsFundedStakeAccount({
      program,
      provider,
      voteAccount,
      lamports,
      configAccount,
    })
    await warpToNextEpoch(provider)
    return sa
  }

  async function createSettlementFundedStakeAccountActivated(
    lamports: number,
    settlementAccount: PublicKey
  ): Promise<PublicKey> {
    const sa = await createSettlementFundedDelegatedStake({
      program,
      provider,
      voteAccount,
      lamports,
      configAccount,
      settlementAccount: settlementAccount,
    })
    await warpToNextEpoch(provider)
    return sa
  }
})
