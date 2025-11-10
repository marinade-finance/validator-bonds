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
  readonly programId: PublicKey
  readonly provider: Provider
  readonly confirmWaitTime: number
  readonly wallet: WalletInterface
  readonly skipPreflight: boolean
  readonly simulate: boolean
  readonly printOnly: boolean
  readonly computeUnitPrice: number
  readonly confirmationFinality: Finality
  readonly verbose: boolean

  constructor({
    provider,
    wallet,
    logger,
    simulate,
    printOnly,
    skipPreflight,
    confirmationFinality,
    computeUnitPrice,
    confirmWaitTime,
    verbose,
    commandName,
  }: {
    provider: Provider
    wallet: WalletInterface
    logger: Logger
    simulate: boolean
    printOnly: boolean
    skipPreflight: boolean
    confirmationFinality: Finality
    computeUnitPrice: number
    confirmWaitTime: number
    verbose: boolean
    commandName: string
  }) {
    super({
      logger,
      commandName,
    })
    this.provider = provider
    this.programId = VALIDATOR_BONDS_PROGRAM_ID
    this.confirmWaitTime = confirmWaitTime
    this.wallet = wallet
    this.simulate = simulate
    this.printOnly = printOnly
    this.skipPreflight = skipPreflight
    this.confirmationFinality = confirmationFinality
    this.computeUnitPrice = computeUnitPrice
    this.verbose = verbose
  }

  get program(): ValidatorBondsProgram {
    return getValidatorBondsProgram({
      connection: this.provider,
    })
  }
}

export function setValidatorBondsCliContext({
  cluster,
  wallet,
  simulate,
  printOnly,
  skipPreflight,
  commitment,
  confirmationFinality,
  computeUnitPrice,
  logger,
  verbose,
  command,
}: {
  cluster: string
  wallet: WalletInterface
  simulate: boolean
  printOnly: boolean
  skipPreflight: boolean
  commitment: string
  confirmationFinality: string
  computeUnitPrice: number
  logger: Logger
  verbose: boolean
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
        provider,
        wallet,
        logger,
        simulate,
        printOnly,
        skipPreflight,
        confirmationFinality: parseConfirmationFinality(confirmationFinality),
        confirmWaitTime,
        computeUnitPrice,
        verbose,
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

export function getCliContext() {
  return getContext<ValidatorBondsCliContext>()
}
