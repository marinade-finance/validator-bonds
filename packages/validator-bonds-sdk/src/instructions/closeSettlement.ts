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
  settlementAuthority,
  withdrawerAuthority,
} from '../sdk'
import { getBond, getSettlement } from '../api'
import { findStakeAccount } from '../web3.js'

export async function closeSettlementInstruction({
  program,
  settlementAccount,
  configAccount,
  bondAccount,
  voteAccount,
  rentCollector,
  splitRentCollector,
  splitRentRefundAccount,
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  rentCollector?: PublicKey
  splitRentCollector?: PublicKey | null
  splitRentRefundAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
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

  const [bondsAuth] = withdrawerAuthority(configAccount, program.programId)

  // when split rent collector is null then there was no need for creation split stake account
  // in such case there is no splitRentCollector set and both, the splitRentCollector and stakeAccount
  // can be set to an arbitrary address
  if (splitRentCollector === null) {
    splitRentCollector = Keypair.generate().publicKey
    splitRentRefundAccount = splitRentRefundAccount || splitRentCollector
  } else if (splitRentRefundAccount === undefined) {
    const [settlementAuth] = settlementAuthority(
      settlementAccount,
      program.programId
    )
    const stakeAccounts = await findStakeAccount({
      connection: program,
      staker: settlementAuth,
      withdrawer: bondsAuth,
      voter: voteAccount,
    })
    if (stakeAccounts.length === 0) {
      throw new Error(
        'Cannot find any stake account usable to close settlement: ' +
          `${settlementAccount.toBase58()} of vote account ${voteAccount?.toBase58()}`
      )
    }
    splitRentRefundAccount = stakeAccounts[0].publicKey
  }

  const instruction = await program.methods
    .closeSettlement()
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
