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
import { AccountInfo, PublicKey } from '@solana/web3.js'
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
  findStakeAccounts,
} from '@marinade.finance/validator-bonds-sdk'
import { ProgramAccount } from '@coral-xyz/anchor'
import { getBondFromAddress, formatToSol, formatUnit } from './utils'
import BN from 'bn.js'
import {
  ProgramAccountInfoNullable,
  VoteAccount,
  getMultipleAccounts,
  getVoteAccountFromData,
} from '@marinade.finance/web3js-common'

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
      'Show information about funding of the Bond account. This option requires a query search ' +
        'for stake accounts at the RPC, which is rate-limited by some operators, especially public RPC endpoints. ' +
        "If you receive the error '429 Too Many Requests,' consider using a private RPC node.",
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

export type VoteAccountShow = Partial<
  Omit<VoteAccount, 'lastTimestamp' | 'epochCredits' | 'priorVoters' | 'votes'>
>
export type BondShow<T> = ProgramAccountWithProgramId<T> & {
  voteAccount?: VoteAccountShow
} & Partial<Omit<BondDataWithFunding, 'voteAccount' | 'bondAccount'>>

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

    let voteAccount: VoteAccountShow | undefined = undefined
    const voteAccounts = await loadVoteAccounts([
      bondData.account.data.voteAccount,
    ])
    if (
      voteAccounts !== undefined &&
      voteAccounts.length > 0 &&
      voteAccounts[0].account !== null
    ) {
      const voteAccountData = voteAccounts[0].account.data
      voteAccount = {
        nodePubkey: voteAccountData.nodePubkey,
        authorizedWithdrawer: voteAccountData.authorizedWithdrawer,
        authorizedVoters: voteAccountData.authorizedVoters,
        commission: voteAccountData.commission,
        rootSlot: voteAccountData.rootSlot,
      }
    }

    data = {
      programId: program.programId,
      publicKey: address,
      account: bondData.account.data,
      voteAccount,
    }

    if (withFunding) {
      const configAccount = config ?? bondData.account.data.config
      const bondFunding = await getBondsFunding({
        program,
        configAccount,
        bondAccounts: [address],
        voteAccounts: [bondData.account.data.voteAccount],
      })
      if (bondFunding.length !== 1) {
        throw new CliCommandError({
          valueName: '[vote account address]|[bond address]',
          value: `${bondData.account.data.voteAccount}|${address.toBase58()}`,
          msg: 'For argument "--with-funding", failed to fetch stake accounts to check evaluate',
        })
      }
      data.amountActive = bondFunding[0].amountActive
      data.amountAtSettlements = bondFunding[0].amountAtSettlements
      data.amountToWithdraw = bondFunding[0].amountToWithdraw
      data.numberActiveStakeAccounts = bondFunding[0].numberActiveStakeAccounts
      data.numberSettlementStakeAccounts =
        bondFunding[0].numberSettlementStakeAccounts
      data.withdrawRequest = bondFunding[0].withdrawRequest
      if (cliContext.logger.isLevelEnabled('debug')) {
        data.bondFundedStakeAccounts = bondFunding[0].bondFundedStakeAccounts
        data.settlementFundedStakeAccounts =
          bondFunding[0].settlementFundedStakeAccounts
      }
    }
  } else {
    // CLI did not provide an address, searching for accounts based on filter parameters
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

    let stakeAccountsDisplay:
      | { pubkey: PublicKey; amount: number }[]
      | undefined = undefined
    if (cliContext.logger.isLevelEnabled('debug')) {
      const bondData = await getBondFromAddress({
        program,
        address: settlementData.bond,
        logger,
        config: undefined,
      })
      const [withdrawalAuth] = bondsWithdrawerAuthority(
        bondData.account.data.config,
        program.programId
      )
      const stakeAccounts = await findStakeAccounts({
        connection: program,
        staker: settlementData.stakerAuthority,
        withdrawer: withdrawalAuth,
        currentEpoch: 0,
      })
      stakeAccountsDisplay = stakeAccounts.map(stakeAccount => ({
        pubkey: stakeAccount.publicKey,
        amount: stakeAccount.account.lamports,
      }))
    }

    data = {
      programId: program.programId,
      publicKey: address,
      account: settlementData,
      stakeAccounts: stakeAccountsDisplay,
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
  if (key.toLowerCase().includes('cpmpe')) {
    return {
      type: 'UseExclusively',
      records: [
        {
          key: 'costPerMillePerEpoch',
          value: new BN(value).toString() + ' ' + formatUnit(value, 'lamport'),
        },
      ],
    }
  }
  if (
    key.startsWith('amount') ||
    key.includes('Amount') ||
    key.startsWith('max')
  ) {
    return format_sol_exclusive(key, value)
  }
  if (key.toLocaleLowerCase() === 'withdrawrequest' && value === undefined) {
    return {
      type: 'UseExclusively',
      records: [{ key, value: '<NOT EXISTING>' }],
    }
  }
  if (key.toLowerCase().includes('bump')) {
    return { type: 'Remove' }
  }
  if (value === undefined) {
    return { type: 'Remove' }
  }
  return { type: 'UsePassThrough' }
}

function format_sol_exclusive(key: string, value: BN): ReformatAction {
  return {
    type: 'UseExclusively',
    records: [
      {
        key,
        value: `${formatToSol(value)}`,
      },
    ],
  }
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

async function loadVoteAccounts(
  addresses: PublicKey[]
): Promise<ProgramAccountInfoNullable<VoteAccount>[] | undefined> {
  const { provider, logger } = getCliContext()

  const toVoteAccount = (
    publicKey: PublicKey,
    account: AccountInfo<Buffer> | null
  ) => {
    if (account === null) {
      return {
        publicKey,
        account: null,
      } as ProgramAccountInfoNullable<VoteAccount>
    } else {
      return getVoteAccountFromData(publicKey, account)
    }
  }

  if (addresses.length === 0) {
    return []
  } else if (addresses.length === 1) {
    try {
      const account = await provider.connection.getAccountInfo(addresses[0])
      return [toVoteAccount(addresses[0], account)]
    } catch (e) {
      logger.debug(
        `Failed to fetch vote account ${addresses[0].toBase58()} data: ${e}`
      )
      return undefined
    }
  }
  try {
    const voteAccounts: Promise<
      ProgramAccount<AccountInfo<VoteAccount> | null>
    >[] = (
      await getMultipleAccounts({ connection: provider.connection, addresses })
    ).map(async ({ publicKey, account }) => toVoteAccount(publicKey, account))
    return Promise.all(voteAccounts)
  } catch (e) {
    const voteAccounts = addresses.map(address => address.toBase58()).join(', ')
    logger.debug(`Failed to fetch vote accounts [${voteAccounts}] data: ${e}`)
    return undefined
  }
}
