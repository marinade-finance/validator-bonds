import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  FundSettlementEvent,
  FUND_SETTLEMENT_EVENT,
  fundSettlementInstruction,
  bondsWithdrawerAuthority,
  getConfig,
} from '../../src'
import { getValidatorInfo, initTest } from './testValidator'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import {
  authorizeStakeAccount,
  delegatedStakeAccount,
  getRentExemptStake,
} from '../utils/staking'
import { pubkey, signer } from '@marinade.finance/web3js-common'

describe('Validator Bonds fund settlement', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let bondAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getValidatorInfo(provider.connection))
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement: 0,
      }
    ))
    ;({ voteAccount, bondAccount } = await executeInitBondInstruction({
      configAccount,
      program,
      provider,
      validatorIdentity,
    }))
  })

  it('fund settlement', async () => {
    const rentCollector = Keypair.generate()
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim: 2 * LAMPORTS_PER_SOL,
    })
    const fundedAmount = 10 * LAMPORTS_PER_SOL
    const { stakeAccount, withdrawer: initWithdrawer } =
      await delegatedStakeAccount({
        provider,
        lamports: fundedAmount,
        voteAccountToDelegate: voteAccount,
      })
    // not needed to activate for this test case
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    await authorizeStakeAccount({
      provider,
      authority: initWithdrawer,
      stakeAccount: stakeAccount,
      withdrawer: bondsAuth,
      staker: bondsAuth,
    })

    const event = new Promise<FundSettlementEvent>(resolve => {
      const listener = program.addEventListener(
        FUND_SETTLEMENT_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const splitRentPayer = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
      splitStakeRentPayer: splitRentPayer,
    })
    await provider.sendIx(
      [operatorAuthority, signer(splitStakeAccount), signer(splitRentPayer)],
      instruction
    )

    const rentExemptStake = await getRentExemptStake(provider)
    const minimalStakeAccountSize =
      rentExemptStake +
      (await getConfig(program, configAccount)).minimumStakeLamports.toNumber()

    await event.then(e => {
      expect(e.settlement).toEqual(settlementAccount)
      expect(e.bond).toEqual(bondAccount)
      expect(e.fundingAmount).toEqual(2 * LAMPORTS_PER_SOL)
      expect(e.lamportsClaimed).toEqual(0)
      expect(e.merkleNodesClaimed).toEqual(0)
      expect(e.splitRentAmount).toEqual(rentExemptStake)
      expect(e.splitRentCollector).toEqual(pubkey(splitRentPayer))
      expect(e.splitStakeAccount?.address).toEqual(pubkey(splitStakeAccount))
      expect(e.splitStakeAccount?.amount).toEqual(
        fundedAmount - 2 * LAMPORTS_PER_SOL - minimalStakeAccountSize
      )
      expect(e.voteAccount).toEqual(voteAccount)
    })
  })
})
