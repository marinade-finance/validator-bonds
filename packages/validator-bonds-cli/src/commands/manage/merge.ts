import { parsePubkey } from '@marinade.finance/cli-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import { transaction } from '@marinade.finance/anchor-common'
import { Wallet, executeTx } from '@marinade.finance/web3js-common'
import {
  CONFIG_ADDRESS,
  mergeInstruction,
} from '@marinade.finance/validator-bonds-sdk'

export function installMerge(program: Command) {
  program
    .command('merge')
    .description('Merging stake accounts belonging to validator bonds program.')
    .requiredOption(
      '--source <pubkey>',
      'Source stake account address to be merged from. ' +
        'This account will be drained and closed.',
      parsePubkey
    )
    .requiredOption(
      '--destination <pubkey>',
      'Destination stake account address to be merged to. ' +
        'This account will be loaded with SOLs from --source.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      'Config account address used to derive stake accounts authority ' +
        'related to the validator bonds program instance.' +
        `(default: ${CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--settlement <pubkey>',
      'Settlement account address used to derive stake accounts authority. (default: not used)',
      parsePubkey
    )
    .action(
      async ({
        source,
        destination,
        config,
        settlement,
      }: {
        source: Promise<PublicKey>
        destination: Promise<PublicKey>
        config?: Promise<PublicKey>
        settlement?: Promise<PublicKey>
      }) => {
        await manageMerge({
          source: await source,
          destination: await destination,
          config: await config,
          settlement: await settlement,
        })
      }
    )
}

async function manageMerge({
  source,
  destination,
  config = CONFIG_ADDRESS,
  settlement = PublicKey.default,
}: {
  source: PublicKey
  destination: PublicKey
  config?: PublicKey
  settlement?: PublicKey
}) {
  const { program, provider, logger, simulate, printOnly, wallet } =
    await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  const { instruction } = await mergeInstruction({
    program,
    sourceStakeAccount: source,
    destinationStakeAccount: destination,
    configAccount: config,
    settlementAccount: settlement,
  })
  tx.add(instruction)

  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage:
      'Failed to create merge stake accounts ' +
      `[source: ${source.toBase58()}, destination: ${destination.toBase58()}]`,
    signers,
    logger,
    simulate,
    printOnly,
  })
  logger.info(
    `Stake account ${source.toBase58()} successfully merged to ${destination.toBase58()}`
  )
}
