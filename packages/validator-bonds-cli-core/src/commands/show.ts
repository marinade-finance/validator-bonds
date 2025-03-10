import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  CliCommandError,
  FORMAT_TYPE_DEF,
  printData,
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
  withdrawRequestAddress,
  settlementClaimsAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { ProgramAccount } from '@coral-xyz/anchor'
import { getBondFromAddress, formatUnit, formatToSolWithAll } from '../utils'
import BN from 'bn.js'
import {
  ProgramAccountInfoNullable,
  VoteAccount,
  getMultipleAccounts,
  getVoteAccountFromData,
} from '@marinade.finance/web3js-common'
import { base64, bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'

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
      parsePubkey,
    )
    .option(
      '--admin <pubkey>',
      'Admin authority to filter the config accounts with',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      '--operator <pubkey>',
      'Operator authority to filter the config accounts with',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'json',
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
        },
      ) => {
        await showConfig({
          address: await address,
          adminAuthority: await admin,
          operatorAuthority: await operator,
          format,
        })
      },
    )
}

export function configureShowBond(program: Command): Command {
  return program
    .command('show-bond')
    .description('Showing data of bond account(s)')
    .argument(
      '[address]',
      'Address of the bond account or vote account or withdraw request. ' +
        'It will show bond account data (when the argument is provided other filter options are ignored)',
      parsePubkey,
    )
    .option(
      '--bond-authority <pubkey>',
      'Bond authority to filter bonds accounts',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      '--with-funding',
      'Show information about funding of the Bond account. This option requires a query search ' +
        'for stake accounts at the RPC, which is rate-limited by some operators, especially public RPC endpoints. ' +
        "If you receive the error '429 Too Many Requests,' consider using a private RPC node.",
      false,
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'json',
    )
}

export function installShowSettlement(program: Command) {
  program
    .command('show-settlement')
    .description('Showing data of settlement account(s)')
    .argument('[address]', 'Address of the settlement account', parsePubkey)
    .option(
      '--bond <pubkey>',
      'Bond account to filter settlements accounts. Provide bond account or vote account address.',
      parsePubkey,
    )
    .option(
      '--epoch <number>',
      'Epoch number to filter the settlements for.',
      v => parseInt(v, 10),
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'json',
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
        },
      ) => {
        await showSettlement({
          address: await address,
          bond: await bond,
          epoch,
          format,
        })
      },
    )
}

export function installShowEvent(program: Command) {
  program
    .command('show-event')
    .description('Showing data of anchor event')
    .argument('<event-data>', 'base64 data of anchor event')
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'json',
    )
    .action(async (eventData: string, { format }: { format: FormatType }) => {
      await showEvent({
        eventData,
        format,
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
          program.programId,
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
          program.programId,
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
  printData(reformatted, format)
}

export type VoteAccountShow = Partial<
  Omit<VoteAccount, 'lastTimestamp' | 'epochCredits' | 'priorVoters' | 'votes'>
>
export type BondShow<T> = ProgramAccountWithProgramId<T> & {
  voteAccount?: VoteAccountShow
} & Partial<Omit<BondDataWithFunding, 'voteAccount' | 'bondAccount'>>

export async function showBond({
  address,
  config,
  voteAccount,
  bondAuthority,
  withFunding,
  format,
  reformatBondFunction,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  bondAuthority?: PublicKey
  withFunding: boolean
  format: FormatType
  reformatBondFunction?: (key: string, value: unknown) => ReformatAction
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
        commission: voteAccountData.commission,
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
      data.amountOwned = bondFunding[0].amountOwned
      data.amountActive = bondFunding[0].amountActive
      data.numberActiveStakeAccounts = bondFunding[0].numberActiveStakeAccounts
      data.amountAtSettlements = bondFunding[0].amountAtSettlements
      data.numberSettlementStakeAccounts =
        bondFunding[0].numberSettlementStakeAccounts
      data.amountToWithdraw = bondFunding[0].amountToWithdraw
      data.epochsToElapseToWithdraw = bondFunding[0].epochsToElapseToWithdraw
      data.withdrawRequest = bondFunding[0].withdrawRequest
      if (cliContext.logger.isLevelEnabled('debug')) {
        data.bondFundedStakeAccounts = bondFunding[0].bondFundedStakeAccounts
        data.settlementFundedStakeAccounts =
          bondFunding[0].settlementFundedStakeAccounts
      }
    } else {
      // funding data is not requested, let's search for withdraw request data at least
      const [withdrawRequestAddr] = withdrawRequestAddress(
        address,
        program.programId,
      )
      const withdrawRequestData =
        await program.account.withdrawRequest.fetchNullable(withdrawRequestAddr)
      if (withdrawRequestData !== null) {
        data.withdrawRequest = {
          publicKey: withdrawRequestAddr,
          account: withdrawRequestData,
        }
      } else {
        data.withdrawRequest = undefined // output shows it does not exist
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
          bondData => bondData.account.voteAccount,
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
            bondFunding.bondAccount.equals(bond.publicKey),
          )
          data[i].amountOwned = bondFunding?.amountOwned
          data[i].amountActive = bondFunding?.amountActive
          data[i].numberActiveStakeAccounts =
            bondFunding?.numberActiveStakeAccounts
          data[i].amountAtSettlements = bondFunding?.amountAtSettlements
          data[i].numberSettlementStakeAccounts =
            bondFunding?.numberSettlementStakeAccounts
          data[i].amountToWithdraw = bondFunding?.amountToWithdraw
          data[i].epochsToElapseToWithdraw =
            bondFunding?.epochsToElapseToWithdraw
          data[i].withdrawRequest = bondFunding?.withdrawRequest
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

  const reformatted = reformat(data, reformatBondFunction ?? reformatBond)
  printData(reformatted, format)
}

export async function showSettlement({
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
        program.programId,
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
        settlementClaims: settlementClaimsAddress(
          settlementData.publicKey,
          program.programId,
        )[0],
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

  const reformatted = reformat(data, reformatSettlement)
  printData(reformatted, format)
}

async function showEvent({
  eventData,
  format,
}: {
  eventData: string
  format: FormatType
}) {
  const { program } = getCliContext()

  // checking if base data is decodable
  // if not, trying to decode the data without the first 8 bytes as Anchor constant CPI discriminator
  let decodedData = program.coder.events.decode(eventData)
  if (decodedData === null) {
    const cpiData = parseAsTransactionCpiData(eventData)
    if (cpiData !== null) {
      decodedData = program.coder.events.decode(cpiData)
    }
  }
  if (decodedData === null) {
    throw new CliCommandError({
      valueName: '<event-data>',
      value: eventData,
      msg: 'Failed to decode event data',
    })
  }

  const reformattedData = reformat(decodedData)
  printData(reformattedData, format)
}

/**
 * Check the log data to be transaction CPI event:
 * Expected data format:
 *  < cpi event discriminator | event name discriminator | event data >
 * If matches cpi event discriminator
 * < event name | event data> base64 formatted is returned
 * otherwise null is returned.
 */
function parseAsTransactionCpiData(log: string): string | null {
  const eventIxTag: BN = new BN('1d9acb512ea545e4', 'hex')
  let encodedLog: Buffer
  try {
    // verification if log is transaction cpi data encoded with base58
    encodedLog = bs58.decode(log)
  } catch (e) {
    return null
  }
  const disc = encodedLog.subarray(0, 8)
  if (disc.equals(eventIxTag.toBuffer('le'))) {
    // after CPI tag data follows in format of standard event
    return base64.encode(encodedLog.subarray(8))
  } else {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reformatBond(key: string, value: any): ReformatAction {
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
  if (key === 'requestedAmount') {
    return formatSolExclusive(key, value)
  }
  if (
    key.startsWith('amount') ||
    key.includes('Amount') ||
    key.startsWith('max')
  ) {
    return formatSolExclusive(key, value)
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

function formatSolExclusive(key: string, value: BN): ReformatAction {
  return {
    type: 'UseExclusively',
    records: [
      {
        key,
        value: `${formatToSolWithAll(value)}`,
      },
    ],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reformatSettlement(key: string, value: any): ReformatAction {
  if (
    key.toLowerCase() === 'merkleroot' &&
    (Array.isArray(value) || value instanceof Uint8Array)
  ) {
    return {
      type: 'UseExclusively',
      records: [
        {
          key,
          value:
            '[' +
            Array.from(value)
              .map(byte => String(byte))
              .join(',') +
            ']',
        },
      ],
    }
  } else if (key.toLowerCase().includes('maxmerklenodes')) {
    return {
      type: 'UseExclusively',
      records: [
        {
          key: 'maxMerkleNodes',
          value: value.toString(),
        },
      ],
    }
  }
  return reformatBond(key, value)
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
  addresses: PublicKey[],
): Promise<ProgramAccountInfoNullable<VoteAccount>[] | undefined> {
  const { provider, logger } = getCliContext()

  const toVoteAccount = (
    publicKey: PublicKey,
    account: AccountInfo<Buffer> | null,
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
        `Failed to fetch vote account ${addresses[0].toBase58()} data: ${e}`,
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
