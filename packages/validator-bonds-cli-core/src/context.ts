import { AnchorProvider } from '@coral-xyz/anchor'
import { CLIContext } from '@marinade.finance/cli-common'
import { getContext, setContext } from '@marinade.finance/ts-common'
import {
  VALIDATOR_BONDS_PROGRAM_ID,
  getProgram as getValidatorBondsProgram,
} from '@marinade.finance/validator-bonds-sdk'
import {
  parseClusterUrl,
  parseCommitment,
  parseConfirmationFinality,
} from '@marinade.finance/web3js-1x'
import { Connection } from '@solana/web3.js'

import type { Provider } from '@coral-xyz/anchor'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { Finality, PublicKey } from '@solana/web3.js'
import type { Logger } from 'pino'

export class ValidatorBondsCliContext extends CLIContext {
  private bondsProgramId?: PublicKey
  readonly provider: Provider
  readonly confirmWaitTime: number
  readonly wallet: WalletInterface
  readonly skipPreflight: boolean
  readonly simulate: boolean
  readonly printOnly: boolean
  readonly computeUnitPrice: number
  readonly confirmationFinality: Finality

  constructor({
    programId,
    provider,
    wallet,
    logger,
    simulate,
    printOnly,
    skipPreflight,
    confirmationFinality,
    computeUnitPrice,
    confirmWaitTime,
    commandName,
  }: {
    programId?: PublicKey
    provider: Provider
    wallet: WalletInterface
    logger: Logger
    simulate: boolean
    printOnly: boolean
    skipPreflight: boolean
    confirmationFinality: Finality
    computeUnitPrice: number
    confirmWaitTime: number
    commandName: string
  }) {
    super({
      logger,
      commandName,
    })
    this.provider = provider
    this.bondsProgramId = programId
    this.confirmWaitTime = confirmWaitTime
    this.wallet = wallet
    this.simulate = simulate
    this.printOnly = printOnly
    this.skipPreflight = skipPreflight
    this.confirmationFinality = confirmationFinality
    this.computeUnitPrice = computeUnitPrice
  }

  set programId(programId: PublicKey | undefined) {
    this.bondsProgramId = programId
  }

  get programId(): PublicKey | undefined {
    return this.bondsProgramId
  }

  get program(): ValidatorBondsProgram {
    return getValidatorBondsProgram({
      connection: this.provider,
      programId: this.bondsProgramId,
    })
  }
}

export function setValidatorBondsCliContext({
  cluster,
  wallet,
  programId,
  simulate,
  printOnly,
  skipPreflight,
  commitment,
  confirmationFinality,
  computeUnitPrice,
  logger,
  command,
}: {
  cluster: string
  wallet: WalletInterface
  programId?: PublicKey
  simulate: boolean
  printOnly: boolean
  skipPreflight: boolean
  commitment: string
  confirmationFinality: string
  computeUnitPrice: number
  logger: Logger
  command: string
}) {
  try {
    const parsedCommitment = parseCommitment(commitment)
    const clusterUrl = parseClusterUrl(cluster)
    const connection = new Connection(clusterUrl, parsedCommitment)
    const provider = new AnchorProvider(connection, wallet, { skipPreflight })

    // this is kind of a workaround how to manage timeouts in the CLI
    // for mainnet-beta public API, adding wait time for confirmation
    const confirmWaitTime = clusterUrl.includes('api.mainnet') ? 4000 : 0

    setContext(
      new ValidatorBondsCliContext({
        programId,
        provider,
        wallet,
        logger,
        simulate,
        printOnly,
        skipPreflight,
        confirmationFinality: parseConfirmationFinality(confirmationFinality),
        confirmWaitTime,
        computeUnitPrice,
        commandName: command,
      }),
    )
    logger.debug(
      `RPC url: ${clusterUrl}, keypair: ${wallet.publicKey.toBase58()}`,
    )
  } catch (e) {
    logger.debug(e)
    throw new Error(`Failed to connect Solana cluster at ${cluster}`)
  }
}

// Configures the CLI validator bonds program id but only when it's not setup already.
// It searches for owner of the provided account and sets the programId as its owner.
export async function setProgramIdByOwner(
  accountPubkey?: PublicKey,
): Promise<ValidatorBondsCliContext> {
  const cliContext = getCliContext()
  if (cliContext.programId === undefined && accountPubkey !== undefined) {
    const accountInfo =
      await cliContext.provider.connection.getAccountInfo(accountPubkey)
    if (accountInfo === null) {
      throw new Error(
        `setProgramIdByOwner: account ${accountPubkey.toBase58()} does not exist` +
          ` on cluster ${cliContext.provider.connection.rpcEndpoint}`,
      )
    }
    cliContext.programId = accountInfo.owner
  }
  return cliContext
}

export function setProgramIdOrDefault(): ValidatorBondsCliContext {
  const cliContext = getCliContext()
  if (cliContext.programId === undefined) {
    cliContext.programId = VALIDATOR_BONDS_PROGRAM_ID
  }
  return cliContext
}

export function getCliContext(): ValidatorBondsCliContext {
  return getContext<ValidatorBondsCliContext>()
}
