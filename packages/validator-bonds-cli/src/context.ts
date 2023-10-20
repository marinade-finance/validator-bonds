import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { Logger } from 'pino'
import { Provider, Wallet } from '@coral-xyz/anchor'
import {
  Context,
  getClusterUrl,
  getContext,
  parseCommitment,
  setContext,
} from '@marinade.finance/cli-common'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import {
  ValidatorBondsProgram,
  getProgram,
} from '@marinade.finance/validator-bonds-sdk'

export class ValidatorBondsCliContext extends Context {
  readonly program: ValidatorBondsProgram
  readonly provider: Provider

  constructor({
    program,
    provider,
    wallet,
    logger,
    skipPreflight,
    simulate,
    printOnly,
    commandName,
  }: {
    program: ValidatorBondsProgram
    provider: Provider
    wallet: WalletInterface
    logger: Logger
    skipPreflight: boolean
    simulate: boolean
    printOnly: boolean
    commandName: string
  }) {
    super({ wallet, logger, skipPreflight, simulate, printOnly, commandName })
    this.provider = provider
    this.program = program
  }
}

export function setValidatorBondsCliContext({
  cluster,
  walletKeypair,
  programId,
  simulate,
  printOnly,
  commitment = 'confirmed',
  skipPreflight,
  logger,
  command,
}: {
  cluster: string
  walletKeypair: Keypair
  programId: PublicKey
  simulate: boolean
  printOnly: boolean
  skipPreflight: boolean
  commitment?: string
  logger: Logger
  command: string
}) {
  try {
    const parsedCommitment = parseCommitment(commitment)
    const connection = new Connection(getClusterUrl(cluster), parsedCommitment)
    const wallet = new Wallet(walletKeypair)
    const program = getProgram({
      connection,
      wallet,
      opts: { skipPreflight },
      programId,
    })
    const provider = program.provider as Provider

    setContext(
      new ValidatorBondsCliContext({
        program,
        provider,
        wallet,
        logger,
        skipPreflight,
        simulate,
        printOnly,
        commandName: command,
      })
    )
  } catch (e) {
    logger.debug(e)
    throw new Error(`Failed to connect Solana cluster at ${cluster}`)
  }
}

export function getCliContext(): ValidatorBondsCliContext {
  return getContext() as ValidatorBondsCliContext
}
