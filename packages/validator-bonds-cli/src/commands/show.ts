import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  CliCommandError,
  FORMAT_TYPE_DEF,
  print_data,
  FormatType,
  reformat,
  reformatReserved,
  ReformatAction,
} from '@marinade.finance/cli-common'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import { getCliContext, setProgramIdByOwner } from '../context'
import {
  Bond,
  CONFIG_ADDRESS,
  Config,
  bondAddress,
  findBonds,
  findConfigs,
  getConfig,
  getVoteAccountFromData,
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
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--operator <pubkey>',
      'Operator authority to filter the config accounts with',
      parsePubkeyOrPubkeyFromWallet
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
      'Address of the bond account or vote account. It will show bond account data (when the argument is provided other filter options are ignored)',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      'Config account to filter the bond accounts with ' +
        `(NO default, e.g., the Marinade config is: ${CONFIG_ADDRESS.toBase58()})`,
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--vote-account <pubkey>',
      'Validator vote account to filter the bond accounts with',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--bond-authority <pubkey>',
      'Bond authority to filter the bond accounts with',
      parsePubkeyOrPubkeyFromWallet
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
          voteAccount,
          bondAuthority,
          format,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          bondAuthority?: Promise<PublicKey>
          format: FormatType
        }
      ) => {
        await showBond({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
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
        valueName: '[address]',
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
  voteAccount,
  bondAuthority,
  format,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  bondAuthority?: PublicKey
  format: FormatType
}) {
  const cliContext = getCliContext()
  let program = cliContext.program
  const logger = cliContext.logger

  let data:
    | ProgramAccountWithProgramId<Bond>
    | ProgramAccountWithProgramId<Bond>[]
  if (address) {
    // Check if address exists as an account on-chain
    let accountInfo = await program.provider.connection.getAccountInfo(address)
    if (accountInfo === null) {
      throw new CliCommandError({
        valueName: '[address]',
        value: address.toBase58(),
        msg: 'Account not found',
      })
    }

    // Check if the address is a vote account
    let voteAccountAddress = null
    try {
      const voteAccount = await getVoteAccountFromData(address, accountInfo)
      voteAccountAddress = voteAccount.publicKey
    } catch (e) {
      // Ignore error, we will try to fetch the address as the bond account data
      logger.debug(
        'Address is not a vote account, considering being it as a bond',
        e
      )
      ;({ program } = await setProgramIdByOwner(address))
    }

    // If the address is a vote account, derive the bond account address from it
    if (voteAccountAddress !== null) {
      if (config === undefined) {
        config = CONFIG_ADDRESS
      }
      ;[address] = bondAddress(config, voteAccountAddress, program.programId)
      accountInfo = await program.provider.connection.getAccountInfo(address)
      if (accountInfo === null) {
        throw new CliCommandError({
          valueName: '[vote account address]:[bond account address]',
          value: voteAccountAddress.toBase58() + ':' + address.toBase58(),
          msg: 'Bond account address derived from provided vote account not found',
        })
      }
    }

    if (accountInfo === null) {
      throw new CliCommandError({
        valueName: '[address]',
        value: address.toBase58(),
        msg: 'Address is neither a vote account nor a bond account',
      })
    }

    // Decode data from the account info
    let bondData
    try {
      bondData = program.coder.accounts.decode<Bond>('bond', accountInfo.data)
    } catch (e) {
      throw new CliCommandError({
        valueName: '[address]',
        value: address.toBase58(),
        msg: 'Failed to fetch bond account data',
        cause: e as Error,
      })
    }

    data = {
      programId: program.programId,
      publicKey: address,
      account: bondData,
    }
  } else {
    // CLI did not provide an address, we will search for accounts based on filter parameters
    try {
      const foundData = await findBonds({
        program,
        config,
        voteAccount,
        bondAuthority,
      })
      data = foundData.map(bondData => ({
        programId: program.programId,
        publicKey: bondData.publicKey,
        account: bondData.account,
      }))
    } catch (err) {
      throw new CliCommandError({
        valueName: '--config|--vote-account|--bond-authority',
        value: `${config?.toBase58()}}|${voteAccount?.toBase58()}|${bondAuthority?.toBase58()}}`,
        msg: 'Error while fetching bond account based on filter parameters',
        cause: err as Error,
      })
    }
  }

  const reformatted = reformat(data, reformatBonds)
  print_data(reformatted, format)
}

async function showEvent({ eventData }: { eventData: string }) {
  const { program } = getCliContext()

  const decodedData = program.coder.events.decode(eventData)
  const reformattedData = reformat(decodedData)
  print_data(reformattedData, 'text')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reformatBonds(key: string, value: any): ReformatAction {
  if (
    typeof key === 'string' &&
    (key as string).startsWith('reserved') &&
    (Array.isArray(value) || value instanceof Uint8Array)
  ) {
    return { type: 'Remove' }
  }
  if (key.toLowerCase() === 'cpmpe') {
    return { type: 'Remove' }
  }
  return { type: 'UsePassThrough' }
}
