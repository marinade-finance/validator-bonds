import { Idl, Program, Provider } from '@coral-xyz/anchor'
import {
  AccountInfo,
  Connection,
  GetProgramAccountsFilter,
  ParsedAccountData,
  PublicKey,
  StakeProgram,
  VoteAccount,
} from '@solana/web3.js'
import assert from 'assert'
import BN from 'bn.js'
import { ProgramAccountInfo, programAccountInfo } from './sdk'

export type StakeAccountParsed = {
  address: PublicKey
  withdrawer: PublicKey | null
  staker: PublicKey | null
  voter: PublicKey | null
  activationEpoch: BN | null
  deactivationEpoch: BN | null
  isCoolingDown: boolean
  isLockedUp: boolean
  balanceLamports: BN | null
  stakedLamports: BN | null
  currentEpoch: number
  currentTimestamp: number
}

function getConnection<IDL extends Idl = Idl>(
  providerOrConnection: Provider | Connection | Program<IDL>
): Connection {
  const connection =
    providerOrConnection instanceof Program
      ? providerOrConnection.provider
      : providerOrConnection
  return connection instanceof Connection ? connection : connection.connection
}

async function parseStakeAccountData(
  connection: Connection,
  address: PublicKey,
  stakeAccountInfo: AccountInfo<ParsedAccountData>,
  currentEpoch?: number
): Promise<StakeAccountParsed> {
  const parsedData = stakeAccountInfo.data.parsed
  const activationEpoch = bnOrNull(
    parsedData?.info?.stake?.delegation?.activationEpoch ?? null
  )
  const deactivationEpoch = bnOrNull(
    parsedData?.info?.stake?.delegation?.deactivationEpoch ?? null
  )
  const lockup = parsedData?.info?.meta?.lockup
  const balanceLamports = bnOrNull(stakeAccountInfo.lamports)
  const stakedLamports = bnOrNull(
    parsedData?.info?.stake?.delegation.stake ?? null
  )
  if (currentEpoch === undefined) {
    ;({ epoch: currentEpoch } = await connection.getEpochInfo())
  }
  const currentTimestamp = Date.now() / 1000

  return {
    address: address,
    withdrawer: pubkeyOrNull(parsedData?.info?.meta?.authorized?.withdrawer),
    staker: pubkeyOrNull(parsedData?.info?.meta?.authorized?.staker),
    voter: pubkeyOrNull(parsedData?.info?.stake?.delegation?.voter),

    activationEpoch,
    deactivationEpoch,
    isCoolingDown: deactivationEpoch ? !deactivationEpoch.eq(U64_MAX) : false,
    isLockedUp:
      lockup?.custodian &&
      lockup?.custodian !== '' &&
      (lockup?.epoch > currentEpoch ||
        lockup?.unixTimestamp > currentTimestamp),
    balanceLamports,
    stakedLamports,
    currentEpoch,
    currentTimestamp,
  }
}

function isAccountInfoParsedData(
  data: AccountInfo<Buffer | ParsedAccountData> | null
): data is AccountInfo<ParsedAccountData> {
  if (data === null) {
    return false
  }
  return (
    data.data &&
    !(data.data instanceof Buffer) &&
    data.data.parsed !== undefined
  )
}

export async function getStakeAccount<IDL extends Idl = Idl>(
  connection: Provider | Connection | Program<IDL>,
  address: PublicKey,
  currentEpoch?: number
): Promise<StakeAccountParsed> {
  connection = getConnection(connection)
  const { value: stakeAccountInfo } = await connection.getParsedAccountInfo(
    address
  )

  if (!stakeAccountInfo) {
    throw new Error(
      `Failed to find the stake account ${address.toBase58()}` +
        `at ${connection.rpcEndpoint}`
    )
  }
  if (!stakeAccountInfo.owner.equals(StakeProgram.programId)) {
    throw new Error(
      `${address.toBase58()} is not a stake account because owner is ${
        stakeAccountInfo.owner
      } at ${connection.rpcEndpoint}`
    )
  }
  if (!isAccountInfoParsedData(stakeAccountInfo)) {
    throw new Error(
      `Failed to parse the stake account ${address.toBase58()} data` +
        `at ${connection.rpcEndpoint}`
    )
  }

  return await parseStakeAccountData(
    connection,
    address,
    stakeAccountInfo,
    currentEpoch
  )
}

const STAKER_OFFSET = 12
const WITHDRAWER_OFFSET = 44

export async function findStakeAccountAccount<IDL extends Idl = Idl>({
  connection,
  staker,
  withdrawer,
}: {
  connection: Provider | Connection | Program<IDL>
  staker?: PublicKey
  withdrawer?: PublicKey
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
  const innerConnection = getConnection(connection)

  const filters: GetProgramAccountsFilter[] = []
  if (staker) {
    filters.push({
      memcmp: {
        offset: STAKER_OFFSET,
        bytes: staker.toBase58(),
      },
    })
  }
  if (withdrawer) {
    filters.push({
      memcmp: {
        offset: WITHDRAWER_OFFSET,
        bytes: withdrawer.toBase58(),
      },
    })
  }

  const parsedStakeAccounts = await innerConnection.getParsedProgramAccounts(
    StakeProgram.programId,
    {
      filters,
    }
  )

  const parsedPromises = parsedStakeAccounts
    .filter(({ pubkey, account }) => {
      if (!isAccountInfoParsedData(account)) {
        console.error(
          `Failed to parse the stake account ${pubkey.toBase58()} data` +
            `at ${innerConnection.rpcEndpoint}`
        )
        return false
      }
      return true
    })
    .map(async ({ pubkey, account }) => {
      assert(isAccountInfoParsedData(account), 'already filtered out')
      return programAccountInfo(
        pubkey,
        account,
        await parseStakeAccountData(innerConnection, pubkey, account)
      )
    })
  return Promise.all(parsedPromises)
}

export async function getVoteAccount<IDL extends Idl = Idl>(
  providerOrConnection: Provider | Connection | Program<IDL>,
  address: PublicKey
): Promise<ProgramAccountInfo<VoteAccount>> {
  const connection = getConnection(providerOrConnection)
  const voteAccountInfo = await connection.getAccountInfo(address)
  if (voteAccountInfo === null) {
    throw new Error(
      `Vote account ${address.toBase58()} not found at endpoint ` +
        `${connection.rpcEndpoint}`
    )
  }
  const voteAccountData = VoteAccount.fromAccountData(voteAccountInfo.data)
  return programAccountInfo(address, voteAccountInfo, voteAccountData)
}

const U64_MAX = new BN('ffffffffffffffff', 16)

function pubkeyOrNull(
  value?: ConstructorParameters<typeof PublicKey>[0] | null
): PublicKey | null {
  return value === null || value === undefined ? null : new PublicKey(value)
}

function bnOrNull(
  value?: ConstructorParameters<typeof BN>[0] | null
): BN | null {
  return value === null || value === undefined ? null : new BN(value)
}
