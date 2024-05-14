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
  MARINADE_CONFIG_ADDRESS,
  Config,
  findBonds,
  findConfigs,
  getConfig,
  getBondsFunding,
  BondDataWithFunding,
  bondsWithdrawerAuthority,
  getSettlement,
  findSettlements,
} from '@marinade.finance/validator-bonds-sdk'
import { ProgramAccount } from '@coral-xyz/anchor'
import { getBondFromAddress } from './utils'

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
      'Address of the bond account or vote account or withdraw request. ' +
        'It will show bond account data (when the argument is provided other filter options are ignored)',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      'Config account to filter bonds accounts ' +
        `(no default, note: the Marinade config is: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--bond-authority <pubkey>',
      'Bond authority to filter bonds accounts',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--with-funding',
      'Show bond accounts with data about its funding. This option is automatically ' +
        'switched-on when the command is provided with [address] of one bond account. ' +
        +'For the search queries this option has to be switched-on manually with this option.',
      false
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
          bondAuthority,
          withFunding,
          format,
        }: {
          config?: Promise<PublicKey>
          bondAuthority?: Promise<PublicKey>
          withFunding: boolean
          format: FormatType
        }
      ) => {
        await showBond({
          address: await address,
          config: await config,
          bondAuthority: await bondAuthority,
          withFunding,
          format,
        })
      }
    )
}

export function installShowSettlement(program: Command) {
  program
    .command('show-settlement')
    .description('Showing data of settlement account(s)')
    .argument('[address]', 'Address of the settlement account' + parsePubkey)
    .option(
      '--bond <pubkey>',
      'Bond account to filter settlements accounts. Provide bond account or vote account address.',
      parsePubkey
    )
    .option(
      '--epoch <number>',
      'Epoch number to filter the settlements for.',
      parseFloat
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
          bond,
          epoch,
          format,
        }: {
          bond?: Promise<PublicKey>
          epoch?: number
          format: FormatType
        }
      ) => {
        await showSettlement({
          address: await address,
          bond: await bond,
          epoch,
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

export type ShowConfigType = ProgramAccountWithProgramId<Config> & {
  bondsWithdrawerAuthority: PublicKey
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
  let data: ShowConfigType | ShowConfigType[]
  if (address) {
    try {
      const configData = await getConfig(program, address)
      data = {
        programId: program.programId,
        publicKey: address,
        account: configData,
        bondsWithdrawerAuthority: bondsWithdrawerAuthority(
          address,
          program.programId
        )[0],
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
        bondsWithdrawerAuthority: bondsWithdrawerAuthority(
          configData.publicKey,
          program.programId
        )[0],
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

  const reformatted = reformat(data, reformatConfig)
  print_data(reformatted, format)
}

export type BondShow<T> = ProgramAccountWithProgramId<T> &
  Partial<Omit<BondDataWithFunding, 'voteAccount' | 'bondAccount'>>

async function showBond({
  address,
  config,
  voteAccount,
  bondAuthority,
  withFunding,
  format,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  bondAuthority?: PublicKey
  withFunding: boolean
  format: FormatType
}) {
  const cliContext = getCliContext()
  const program = cliContext.program
  const logger = cliContext.logger

  let data: BondShow<Bond> | BondShow<Bond>[]
  if (address) {
    const bondData = await getBondFromAddress({
      program,
      address,
      logger,
      config,
    })
    address = bondData.publicKey

    const configAccount = config ?? bondData.account.data.config
    const bondFunding = await getBondsFunding({
      program,
      configAccount,
      bondAccounts: [address],
      voteAccounts: [bondData.account.data.voteAccount],
    })
    if (bondFunding.length !== 1) {
      throw new CliCommandError({
        valueName: '[address]',
        value: address.toBase58(),
        msg: 'Failed to fetch bond account funding data',
      })
    }

    data = {
      programId: program.programId,
      publicKey: address,
      account: bondData.account.data,
      amountActive: bondFunding[0].amountActive,
      amountAtSettlements: bondFunding[0].amountAtSettlements,
      amountToWithdraw: bondFunding[0].amountToWithdraw,
      numberActiveStakeAccounts: bondFunding[0].numberActiveStakeAccounts,
      numberSettlementStakeAccounts:
        bondFunding[0].numberSettlementStakeAccounts,
      withdrawRequest: bondFunding[0].withdrawRequest,
      bondFundedStakeAccounts: cliContext.logger.isLevelEnabled('debug')
        ? bondFunding[0].bondFundedStakeAccounts
        : undefined,
      settlementFundedStakeAccounts: cliContext.logger.isLevelEnabled('debug')
        ? bondFunding[0].settlementFundedStakeAccounts
        : undefined,
    }
  } else {
    // CLI did not provide an address, we will search for accounts based on filter parameters
    try {
      const bondDataArray = await findBonds({
        program,
        configAccount: config,
        voteAccount,
        bondAuthority,
      })
      data = bondDataArray.map(bondData => ({
        programId: program.programId,
        publicKey: bondData.publicKey,
        account: bondData.account,
      }))

      if (withFunding && bondDataArray.length > 0) {
        const configAccount = config ?? bondDataArray[0].account.config
        const bondAccounts = bondDataArray.map(bondData => bondData.publicKey)
        const voteAccounts = bondDataArray.map(
          bondData => bondData.account.voteAccount
        )
        const bondsFunding = await getBondsFunding({
          program,
          configAccount,
          bondAccounts,
          voteAccounts,
        })
        for (let i = 0; i < data.length; i++) {
          const bond = data[i]
          const bondFunding = bondsFunding.find(bondFunding =>
            bondFunding.bondAccount.equals(bond.publicKey)
          )
          data[i].amountActive = bondFunding?.amountActive
          data[i].amountAtSettlements = bondFunding?.amountAtSettlements
          data[i].amountToWithdraw = bondFunding?.amountToWithdraw
          ;(data[i].numberActiveStakeAccounts =
            bondFunding?.numberActiveStakeAccounts),
            (data[i].numberSettlementStakeAccounts =
              bondFunding?.numberSettlementStakeAccounts),
            (data[i].withdrawRequest = bondFunding?.withdrawRequest)
          if (cliContext.logger.isLevelEnabled('debug')) {
            data[i].bondFundedStakeAccounts =
              bondFunding?.bondFundedStakeAccounts
            data[i].settlementFundedStakeAccounts =
              bondFunding?.settlementFundedStakeAccounts
          }
        }
      }
    } catch (err) {
      throw new CliCommandError({
        valueName: '--config|--bond-authority',
        value: `${config?.toBase58()}}|${voteAccount?.toBase58()}|${bondAuthority?.toBase58()}}`,
        msg: 'Error while fetching bond account based on filter parameters',
        cause: err as Error,
      })
    }
  }

  const reformatted = reformat(data, reformatBond)
  print_data(reformatted, format)
}

async function showSettlement({
  address,
  bond,
  epoch,
  format,
}: {
  address?: PublicKey
  bond?: PublicKey
  epoch?: number
  format: FormatType
}) {
  const cliContext = getCliContext()
  const program = cliContext.program
  const logger = cliContext.logger

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any | any[]

  if (address !== undefined) {
    const settlementData = await getSettlement(program, address)
    data = {
      programId: program.programId,
      publicKey: address,
      account: settlementData,
    }
  } else {
    try {
      if (bond !== undefined) {
        const bondData = await getBondFromAddress({
          program,
          address: bond,
          logger,
          config: undefined,
        })
        bond = bondData.publicKey
      }
      const settlementDataArray = await findSettlements({
        program,
        bond,
        epoch,
      })

      data = settlementDataArray.map(settlementData => ({
        programId: program.programId,
        publicKey: settlementData.publicKey,
        account: settlementData.account,
      }))
    } catch (err) {
      throw new CliCommandError({
        valueName: '--bond|--epoch',
        value: `${bond?.toBase58()}|${epoch}`,
        msg: 'Error while fetching settlement accounts based on filter parameters',
        cause: err as Error,
      })
    }
  }

  const reformatted = reformat(data, reformatBond)
  print_data(reformatted, format)
}

async function showEvent({ eventData }: { eventData: string }) {
  const { program } = getCliContext()

  const decodedData = program.coder.events.decode(eventData)
  const reformattedData = reformat(decodedData)
  print_data(reformattedData, 'text')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reformatBond(key: string, value: any): ReformatAction {
  if (
    typeof key === 'string' &&
    (key as string).startsWith('reserved') &&
    (Array.isArray(value) || value instanceof Uint8Array)
  ) {
    return { type: 'Remove' }
  }
  if (key.toLowerCase() === 'cpmpe' || key.toLowerCase().includes('bump')) {
    return { type: 'Remove' }
  }
  if (key.toLocaleLowerCase() === 'withdrawrequest' && value === undefined) {
    return {
      type: 'UseExclusively',
      records: [{ key, value: '<NOT EXISTING>' }],
    }
  }
  if (value === undefined) {
    return { type: 'Remove' }
  }
  return { type: 'UsePassThrough' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reformatConfig(key: string, value: any): ReformatAction {
  const reserveReformatted = reformatReserved(key, value)
  if (reserveReformatted.type === 'UsePassThrough') {
    if (key.toLowerCase().includes('bump')) {
      return { type: 'Remove' }
    }
    return { type: 'UsePassThrough' }
  } else {
    return reserveReformatted
  }
}
