import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  MARINADE_CONFIG_ADDRESS,
  ValidatorBondsProgram,
  withdrawRequestAddress,
} from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getBond } from '../api'
import { LoggerPlaceholder, logWarn } from '@marinade.finance/ts-common'

/**
 * Generate instruction to create withdraw request for bond account.
 * Only bond authority or validator identity of vote account voter pubkey can create this request.
 * Only a single withdraw request per bond can be created.
 * The amount can be withdrawn when lockup time elapses (configured in config).
 * When created with a wrong amount then cancel first the request and init a new one.
 * The amount in lamports subtracted from the calculated amount funded to bond.
 */
export async function initWithdrawRequestInstruction({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  authority = anchorProgramWalletPubkey(program),
  rentPayer = anchorProgramWalletPubkey(program),
  amount,
  logger,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
  amount: BN | number
  logger?: LoggerPlaceholder
}): Promise<{
  instruction: TransactionInstruction
  bondAccount: PublicKey
  withdrawRequestAccount: PublicKey
}> {
  if (!bondAccount && !configAccount && voteAccount) {
    logWarn(
      logger,
      'initWithdrawRequest SDK: config is not provided, using default address: ' +
        MARINADE_CONFIG_ADDRESS.toBase58(),
    )
    configAccount = MARINADE_CONFIG_ADDRESS
  }
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId,
  )
  if (!voteAccount || !configAccount) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = voteAccount ?? bondData.voteAccount
    configAccount = configAccount ?? bondData.config
  }

  authority = authority instanceof PublicKey ? authority : authority.publicKey
  rentPayer = rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey
  const [withdrawRequest] = withdrawRequestAddress(
    bondAccount,
    program.programId,
  )

  const instruction = await program.methods
    .initWithdrawRequest({
      amount: new BN(amount),
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      withdrawRequest,
      authority,
      rentPayer,
    })
    .instruction()
  return {
    bondAccount,
    withdrawRequestAccount: withdrawRequest,
    instruction,
  }
}
