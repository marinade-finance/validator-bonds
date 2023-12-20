import * as anchor from '@coral-xyz/anchor'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { AnchorProvider } from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram, getStakeAccount } from '../../src'
import { ExtendedProvider } from '../utils/provider'
import {
  Connection,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { transaction } from '@marinade.finance/anchor-common'
import { executeTxSimple } from '@marinade.finance/web3js-common'
import { sleep } from '../utils/helpers'

export class AnchorExtendedProvider
  extends AnchorProvider
  implements ExtendedProvider
{
  async sendIx(
    signers: (WalletInterface | Signer)[],
    ...ixes: (
      | Transaction
      | TransactionInstruction
      | TransactionInstructionCtorFields
    )[]
  ): Promise<void> {
    const tx = await transaction(this)
    tx.add(...ixes)
    await executeTxSimple(this.connection, tx, [this.wallet, ...signers])
  }

  get walletPubkey(): PublicKey {
    return this.wallet.publicKey
  }
}

export async function initTest(): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorExtendedProvider
}> {
  const anchorProvider = AnchorExtendedProvider.env()
  const provider = new AnchorExtendedProvider(
    anchorProvider.connection,
    anchorProvider.wallet,
    { ...anchorProvider.opts, skipPreflight: true }
  )
  anchor.setProvider(provider)
  return { program: getProgram(provider), provider }
}

// NOTE: the Anchor.toml configures slots_per_epoch to 32,
export async function waitForStakeAccountActivation({
  stakeAccount,
  connection,
  timeoutSeconds = 30,
  activatedAtLeastFor = 0,
}: {
  stakeAccount: PublicKey
  connection: Connection
  timeoutSeconds?: number
  activatedAtLeastFor?: number
}) {
  // 1. waiting for the stake account to be activated
  {
    const startTime = Date.now()
    let stakeStatus = await connection.getStakeActivation(stakeAccount)
    while (stakeStatus.state !== 'active') {
      await sleep(1000)
      stakeStatus = await connection.getStakeActivation(stakeAccount)
      if (Date.now() - startTime > timeoutSeconds * 1000) {
        throw new Error(
          `Stake account ${stakeAccount.toBase58()} was not activated in timeout of ${timeoutSeconds} seconds`
        )
      }
    }
  }

  // 2. the stake account is active, but it needs to be active for at least waitForEpochs epochs
  if (activatedAtLeastFor > 0) {
    const stakeAccountData = await getStakeAccount(connection, stakeAccount)
    const stakeAccountActivationEpoch = stakeAccountData.activationEpoch
    if (stakeAccountActivationEpoch === null) {
      throw new Error(
        'Expected stake account to be already activated. Unexpected setup error stake account:' +
          stakeAccountData
      )
    }

    const startTime = Date.now()
    let currentEpoch = (await connection.getEpochInfo()).epoch
    if (
      currentEpoch <
      stakeAccountActivationEpoch.toNumber() + activatedAtLeastFor
    ) {
      console.debug(
        `Waiting for the stake account ${stakeAccount.toBase58()} to be active at least for ${activatedAtLeastFor} epochs ` +
          `currently active for ${
            currentEpoch - stakeAccountActivationEpoch.toNumber()
          } epoch(s)`
      )
    }
    while (
      currentEpoch <
      stakeAccountActivationEpoch.toNumber() + activatedAtLeastFor
    ) {
      if (Date.now() - startTime > timeoutSeconds * 1000) {
        throw new Error(
          `Stake account ${stakeAccount.toBase58()} was activated but timeout ${timeoutSeconds} elapsed when waiting ` +
            `for ${activatedAtLeastFor} epochs the account to be activated, it's activated only for ` +
            `${
              currentEpoch - stakeAccountActivationEpoch.toNumber()
            } epochs at this time`
        )
      }
      await sleep(1000)
      currentEpoch = (await connection.getEpochInfo()).epoch
    }
  }
}
