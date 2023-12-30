import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { Logger } from 'pino'
import { AnchorProvider, Provider, Wallet } from '@coral-xyz/anchor'
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
  getProgram as getValidatorBondsProgram,
} from '@marinade.finance/validator-bonds-sdk'

export class ValidatorBondsCliContext extends Context {
  private bondsProgramId?: PublicKey
  readonly provider: Provider

  constructor({
    programId,
    provider,
    wallet,
    logger,
    skipPreflight,
    simulate,
    printOnly,
    commandName,
  }: {
    programId?: PublicKey
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
    this.bondsProgramId = programId
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
  programId?: PublicKey
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
    const provider = new AnchorProvider(connection, wallet, { skipPreflight })

    setContext(
      new ValidatorBondsCliContext({
        programId,
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

// Configures the CLI validator bonds program id but only when it's not setup already.
// It searches for owner of the provided account and sets the programId as its owner.
export async function setProgramIdByOwner(
  accountPubkey?: PublicKey
): Promise<ValidatorBondsCliContext> {
  const cliContext = getCliContext()
  if (cliContext.programId === undefined && accountPubkey !== undefined) {
    const accountInfo = await cliContext.provider.connection.getAccountInfo(
      accountPubkey
    )
    if (accountInfo === null) {
      throw new Error(
        `setProgramIdByOwner: account ${accountPubkey.toBase58()} does not exist` +
          ` on cluster ${cliContext.provider.connection.rpcEndpoint}`
      )
    }
    cliContext.programId = accountInfo.owner
  }
  return cliContext
}

export function getCliContext(): ValidatorBondsCliContext {
  return getContext() as ValidatorBondsCliContext
}
