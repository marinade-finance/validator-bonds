import {
  parsePubkey,
  CliCommandError,
  FORMAT_TYPE_DEF,
  print_data,
  FormatType,
  reformat,
  reformatReserved,
} from '@marinade.finance/cli-common'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import { getCliContext, setProgramIdByOwner } from '../context'
import {
  Bond,
  Config,
  findBonds,
  findConfigs,
  getBond,
  getConfig,
} from '@marinade.finance/validator-bonds-sdk'
import { ProgramAccount } from '@coral-xyz/anchor'

export type ProgramAccountWithProgramId<T> = ProgramAccount<T> & {
  programId: PublicKey
}

export function installShowConfig(program: Command) {
  program
    .command('show-config')
    .description('Showing data of config account(s)')
    .argument(
      '[address]',
      'Address of the config account to show (when the argument is provided other filter options are ignored)',
      parsePubkey
    )
    .option(
      '--admin <pubkey>',
      'Admin authority to filter the config accounts with',
      parsePubkey
    )
    .option(
      '--operator <pubkey>',
      'Operator authority to filter the config accounts with',
      parsePubkey
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'text'
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          admin,
          operator,
          format,
        }: {
          admin?: Promise<PublicKey>
          operator?: Promise<PublicKey>
          format: FormatType
        }
      ) => {
        await showConfig({
          address: await address,
          adminAuthority: await admin,
          operatorAuthority: await operator,
          format,
        })
      }
    )
}

export function installShowBond(program: Command) {
  program
    .command('show-bond')
    .description('Showing data of bond account(s)')
    .argument(
      '[address]',
      'Address of the bond account to show (when the argument is provided other filter options are ignored)',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      'Config account to filter the bond accounts with',
      parsePubkey
    )
    .option(
      '--validator-vote-account <pubkey>',
      'Validator vote account to filter the bond accounts with',
      parsePubkey
    )
    .option(
      '--bond-authority <pubkey>',
      'Bond authority to filter the bond accounts with',
      parsePubkey
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'text'
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          validatorVoteAccount,
          bondAuthority,
          format,
        }: {
          config?: Promise<PublicKey>
          validatorVoteAccount?: Promise<PublicKey>
          bondAuthority?: Promise<PublicKey>
          format: FormatType
        }
      ) => {
        await showBond({
          address: await address,
          config: await config,
          validatorVoteAccount: await validatorVoteAccount,
          bondAuthority: await bondAuthority,
          format,
        })
      }
    )
}

export function installShowEvent(program: Command) {
  program
    .command('show-event')
    .description('Showing data of anchor event')
    .argument('<event-data>', 'base64 data of anchor event')
    .option('-t, --event-type <init>', 'Type of event to decode', 'init')
    .action(async (eventData: string) => {
      await showEvent({
        eventData,
      })
    })
}

async function showConfig({
  address,
  adminAuthority,
  operatorAuthority,
  format,
}: {
  address?: PublicKey
  adminAuthority?: PublicKey
  operatorAuthority?: PublicKey
  format: FormatType
}) {
  const { program } = await setProgramIdByOwner(address)

  // CLI provided an address, we will search for that one account
  let data:
    | ProgramAccountWithProgramId<Config>
    | ProgramAccountWithProgramId<Config>[]
  if (address) {
    try {
      const configData = await getConfig(program, address)
      data = {
        programId: program.programId,
        publicKey: address,
        account: configData,
      }
    } catch (e) {
      throw new CliCommandError({
        valueName: '--address',
        value: address.toBase58(),
        msg: 'Failed to fetch config account data',
        cause: e as Error,
      })
    }
  } else {
    // CLI did not provide an address, we will search for accounts based on filter parameters
    try {
      const foundData = await findConfigs({
        program,
        adminAuthority,
        operatorAuthority,
      })
      data = foundData.map(configData => ({
        programId: program.programId,
        publicKey: configData.publicKey,
        account: configData.account,
      }))
    } catch (err) {
      throw new CliCommandError({
        valueName: '--admin|--operator',
        value: `${adminAuthority?.toBase58()}}|${operatorAuthority?.toBase58()}}`,
        msg: 'Error while fetching config account based on filter parameters',
        cause: err as Error,
      })
    }
  }

  const reformatted = reformat(data, reformatReserved)
  print_data(reformatted, format)
}

async function showBond({
  address,
  config,
  validatorVoteAccount,
  bondAuthority,
  format,
}: {
  address?: PublicKey
  config?: PublicKey
  validatorVoteAccount?: PublicKey
  bondAuthority?: PublicKey
  format: FormatType
}) {
  const { program } = await setProgramIdByOwner(address)

  let data:
    | ProgramAccountWithProgramId<Bond>
    | ProgramAccountWithProgramId<Bond>[]
  if (address) {
    try {
      const bondData = await getBond(program, address)
      data = {
        programId: program.programId,
        publicKey: address,
        account: bondData,
      }
    } catch (e) {
      throw new CliCommandError({
        valueName: '--address',
        value: address.toBase58(),
        msg: 'Failed to fetch bond account data',
        cause: e as Error,
      })
    }
  } else {
    // CLI did not provide an address, we will search for accounts based on filter parameters
    try {
      const foundData = await findBonds({
        program,
        config,
        validatorVoteAccount,
        bondAuthority,
      })
      data = foundData.map(bondData => ({
        programId: program.programId,
        publicKey: bondData.publicKey,
        account: bondData.account,
      }))
    } catch (err) {
      throw new CliCommandError({
        valueName: '--config|--validator-vote-account|--bond-authority',
        value: `${config?.toBase58()}}|${validatorVoteAccount?.toBase58()}|${bondAuthority?.toBase58()}}`,
        msg: 'Error while fetching bond account based on filter parameters',
        cause: err as Error,
      })
    }
  }

  const reformatted = reformat(data, reformatReserved)
  print_data(reformatted, format)
}

async function showEvent({ eventData }: { eventData: string }) {
  const { program } = getCliContext()

  const decodedData = program.coder.events.decode(eventData)
  const reformattedData = reformat(decodedData)
  print_data(reformattedData, 'text')
}
