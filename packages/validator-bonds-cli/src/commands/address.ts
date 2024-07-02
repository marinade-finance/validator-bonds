import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  CliCommandError,
} from '@marinade.finance/cli-common'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner, setProgramIdOrDefault } from '../context'
import {
  MARINADE_CONFIG_ADDRESS,
  bondAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { ProgramAccount } from '@coral-xyz/anchor'

export type ProgramAccountWithProgramId<T> = ProgramAccount<T> & {
  programId: PublicKey
}

export function installShowBondAddress(program: Command) {
  program
    .command('bond-address')
    .description(
      'From provided vote account address derives the bond account address'
    )
    .argument(
      '<address>',
      'Address of the vote account to get derived bond account address',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--config <pubkey>',
      'Config account to filter bonds accounts ' +
        `(no default, note: the Marinade config is: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
        }: {
          config?: Promise<PublicKey>
        }
      ) => {
        await showBondAddress({
          address: await address,
          config: await config,
        })
      }
    )
}

async function showBondAddress({
  address,
  config = MARINADE_CONFIG_ADDRESS,
}: {
  address: PublicKey
  config?: PublicKey
}) {
  const { program, logger } = setProgramIdOrDefault()

  try {
    const [bondAddr, bondBump] = bondAddress(config, address, program.programId)
    logger.debug(
      'Deriving bond account address from vote account: ' +
        `${address.toBase58()}, config: ${config.toBase58()}, programId: ${program.programId.toBase58()}`
    )
    console.log(
      `Bond account address: ${bondAddr.toBase58()} [bump: ${bondBump}]`
    )
  } catch (err) {
    throw new CliCommandError({
      valueName: 'voteAccount|--config',
      value: `${address.toBase58()}}|${config.toBase58()}}`,
      msg: 'Error while deriving bond account address from vote account address',
      cause: err as Error,
    })
  }
}
