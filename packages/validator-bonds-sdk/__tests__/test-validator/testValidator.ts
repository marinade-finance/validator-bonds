import * as anchor from '@coral-xyz/anchor'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { AnchorProvider } from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram, getStakeAccount } from '../../src'
import { ExtendedProvider } from '../utils/provider'
import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { transaction } from '@marinade.finance/anchor-common'
import { executeTxSimple } from '@marinade.finance/web3js-common'
import { sleep } from '../utils/helpers'
import { readFile } from 'fs/promises'
import fs from 'fs'

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

export function getValidatorIdentity(): Keypair {
  return Keypair.generate()
}

// NOTE: the Anchor.toml configures slots_per_epoch to 32, otherwise
//       waiting for activation will be pretty long and this method probably timeouts
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

export async function getValidatorInfo(connection: Connection): Promise<{
  votePubkey: PublicKey
  validatorIdentity: Keypair
  validatorIdentityPath: string
}> {
  // loading the test validator identity key pair, we expect the Anchor paths are defaults
  // and that the tests is run with `pnpm test` from the root directory
  const testIdentityKeypairPath =
    process.cwd() + '/.anchor/test-ledger/validator-keypair.json'
  if (!fs.existsSync(testIdentityKeypairPath)) {
    throw new Error(
      `Expected test validator identity key pair at ${testIdentityKeypairPath} but file not found`
    )
  }
  const validatorIdentityPath = testIdentityKeypairPath
  const validatorIdentity = await parseKeypair(testIdentityKeypairPath)

  // let's verify the leader schedule matches the validator identity
  const leaderSchedule = await connection.getLeaderSchedule()
  const isScheduledOnlyTestValidator = Object.keys(leaderSchedule).every(
    address => address === validatorIdentity.publicKey.toBase58()
  )
  if (!isScheduledOnlyTestValidator) {
    throw new Error(
      'Error on global setup: expected only test validator being run and scheduled as leader'
    )
  }

  const voteAccounts = await connection.getVoteAccounts()
  // expecting run on localhost and only one voting vote account is available
  // i.e., one validator solana-test-validator is voting and the validator identity is the same
  if (voteAccounts.current.length !== 1) {
    throw new Error(
      'Expected one vote account of solana-test-validator. Cannot continue in global local test setup.' +
        ` Number of vote accounts found: ${voteAccounts.current.length}`
    )
  }
  const votePubkey = new PublicKey(voteAccounts.current[0].votePubkey)
  if (
    voteAccounts.current[0].nodePubkey !==
    validatorIdentity.publicKey.toBase58()
  ) {
    throw new Error(
      `Expected validator identity ${validatorIdentity.publicKey.toBase58()} to be the same as the vote account node pubkey ${
        voteAccounts.current[0].nodePubkey
      }`
    )
  }

  return {
    votePubkey,
    validatorIdentity,
    validatorIdentityPath,
  }
}

async function parseKeypair(path: string): Promise<Keypair> {
  const fileContent = await readFile(path, 'utf-8')
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fileContent)))
}
