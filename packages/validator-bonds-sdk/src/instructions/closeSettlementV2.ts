import {
  PublicKey,
  TransactionInstruction,
  StakeProgram,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  Keypair,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
} from '../sdk'
import { getBond, getSettlement } from '../api'
import { findStakeAccounts } from '../web3.js'

export type CloseSettlementParams = {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  rentCollector?: PublicKey
  splitRentCollector?: PublicKey | null
  splitRentRefundAccount?: PublicKey
}

/**
 * Generate instruction to close settlement.
 * This is a permission-less operation,
 * the settlement can be closed when timeout elapses (configured in config).
 */
export async function closeSettlementV2Instruction(
  params: CloseSettlementParams,
): Promise<{
  instruction: TransactionInstruction
}> {
  const {
    configAccount,
    bondAccount,
    settlementAccount,
    rentCollector,
    bondsAuth,
    splitRentCollector,
    splitRentRefundAccount,
  } = await getCloseSettlementAccounts(params)

  const instruction = await params.program.methods
    .closeSettlementV2()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      rentCollector,
      splitRentCollector,
      bondsWithdrawerAuthority: bondsAuth,
      splitRentRefundAccount,
      stakeProgram: StakeProgram.programId,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
    })
    .instruction()
  return {
    instruction,
  }
}

export async function getCloseSettlementAccounts({
  program,
  settlementAccount,
  configAccount,
  bondAccount,
  voteAccount,
  rentCollector,
  splitRentCollector,
  splitRentRefundAccount,
}: CloseSettlementParams): Promise<{
  configAccount: PublicKey
  bondAccount: PublicKey
  settlementAccount: PublicKey
  rentCollector: PublicKey
  bondsAuth: PublicKey
  splitRentCollector: PublicKey
  splitRentRefundAccount: PublicKey
}> {
  if (
    voteAccount !== undefined &&
    configAccount !== undefined &&
    bondAccount === undefined
  ) {
    ;[bondAccount] = bondAddress(configAccount, voteAccount, program.programId)
  }
  if (
    bondAccount === undefined ||
    rentCollector === undefined ||
    splitRentCollector === undefined
  ) {
    const settlementData = await getSettlement(program, settlementAccount)
    bondAccount = settlementData.bond
    rentCollector = rentCollector || settlementData.rentCollector
    splitRentCollector = splitRentCollector || settlementData.splitRentCollector
  }

  if (
    configAccount === undefined ||
    (voteAccount === undefined && splitRentRefundAccount === undefined)
  ) {
    const bondData = await getBond(program, bondAccount)
    configAccount = configAccount || bondData.config
    voteAccount = bondData.voteAccount
  }

  const [bondsAuth] = bondsWithdrawerAuthority(configAccount, program.programId)

  // when split rent collector is null then there was no need for creation split stake account
  // in such case there is no splitRentCollector set and both, the splitRentCollector and stakeAccount
  // can be set to an arbitrary address
  if (splitRentCollector === null) {
    splitRentCollector = Keypair.generate().publicKey
    splitRentRefundAccount = splitRentRefundAccount || splitRentCollector
  } else if (splitRentRefundAccount === undefined) {
    const [settlementAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )
    const stakeAccounts = await findStakeAccounts({
      connection: program,
      staker: settlementAuth,
      withdrawer: bondsAuth,
      voter: voteAccount,
      currentEpoch: 0,
    })
    if (stakeAccounts.length === 0) {
      throw new Error(
        'Cannot find any stake account usable to close settlement: ' +
          `${settlementAccount.toBase58()} of vote account ${voteAccount?.toBase58()}`,
      )
    }
    splitRentRefundAccount = stakeAccounts[0].publicKey
  }

  return {
    configAccount,
    bondAccount,
    settlementAccount,
    rentCollector,
    bondsAuth,
    splitRentCollector,
    splitRentRefundAccount,
  }
}
