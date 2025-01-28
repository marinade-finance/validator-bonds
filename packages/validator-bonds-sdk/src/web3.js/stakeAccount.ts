import {
  Connection,
  GetProgramAccountsFilter,
  PublicKey,
  StakeProgram,
} from '@solana/web3.js'
import {
  HasProvider,
  ProgramAccountInfo,
  ProgramAccountInfoNoData,
  Provider,
  U64_MAX,
  getAccountInfoNoData,
  getConnection,
  getMultipleAccounts,
  isWithPublicKey,
  programAccountInfo,
} from '@marinade.finance/web3js-common'
import { deserializeUnchecked } from 'borsh'
import {
  Meta,
  StakeState,
  STAKE_STATE_BORSH_SCHEMA,
} from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import assert from 'assert'
import BN from 'bn.js'

// borrowed from https://github.com/marinade-finance/marinade-ts-sdk/blob/v5.0.6/src/marinade-state/marinade-state.ts#L234
export function deserializeStakeState(data: Buffer | undefined): StakeState {
  if (data === null || data === undefined) {
    throw new Error('StakeState data buffer is missing')
  }
  // The data's first 4 bytes are: u8 0x0 0x0 0x0 but borsh uses only the first byte to find the enum's value index.
  // The next 3 bytes are unused and we need to get rid of them (or somehow fix the BORSH schema?)
  const adjustedData = Buffer.concat([
    data.subarray(0, 1), // the first byte indexing the enum
    data.subarray(4, data.length), // the first byte indexing the enum
  ])
  return deserializeUnchecked(
    STAKE_STATE_BORSH_SCHEMA,
    StakeState,
    adjustedData,
  )
}

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

function getMeta(
  stakeAccountInfo: ProgramAccountInfo<StakeState>,
): Meta | undefined {
  return (
    stakeAccountInfo.account.data.Stake?.meta ||
    stakeAccountInfo.account.data.Initialized?.meta
  )
}

async function parseStakeAccountData(
  connection: Connection,
  stakeAccountInfo: ProgramAccountInfo<StakeState>,
  currentEpoch?: BN | number | bigint,
): Promise<StakeAccountParsed> {
  const meta = getMeta(stakeAccountInfo)
  const delegation = stakeAccountInfo.account.data.Stake?.stake.delegation

  const activationEpoch = bnOrNull(delegation?.activationEpoch ?? null)
  const deactivationEpoch = bnOrNull(delegation?.deactivationEpoch ?? null)
  const lockup = meta?.lockup
  const balanceLamports = bnOrNull(stakeAccountInfo.account.lamports)
  const stakedLamports = bnOrNull(delegation?.stake ?? null)
  if (currentEpoch === undefined) {
    ;({ epoch: currentEpoch } = await connection.getEpochInfo())
  }
  currentEpoch = new BN(currentEpoch.toString())
  const currentTimestamp = new BN(Date.now() / 1000)

  return {
    address: stakeAccountInfo.publicKey,
    withdrawer: pubkeyOrNull(meta?.authorized?.withdrawer),
    staker: pubkeyOrNull(meta?.authorized?.staker),
    voter: pubkeyOrNull(delegation?.voterPubkey),
    activationEpoch,
    deactivationEpoch,
    isCoolingDown: deactivationEpoch ? !deactivationEpoch.eq(U64_MAX) : false,
    isLockedUp:
      lockup !== undefined &&
      lockup.custodian &&
      lockup.custodian !== undefined &&
      lockup.custodian !== PublicKey.default &&
      (lockup?.epoch.gt(currentEpoch) ||
        lockup?.unixTimestamp.gt(currentTimestamp)),
    balanceLamports,
    stakedLamports,
    currentEpoch: currentEpoch.toNumber(),
    currentTimestamp: currentTimestamp.toNumber(),
  }
}

export async function getStakeAccount(
  connection: Provider | Connection | HasProvider,
  address: PublicKey,
  currentEpoch?: number | BN | bigint,
): Promise<StakeAccountParsed> {
  connection = getConnection(connection)
  const accountInfo = await connection.getAccountInfo(address)

  if (!accountInfo) {
    throw new Error(
      `Failed to find the stake account ${address.toBase58()}` +
        `at ${connection.rpcEndpoint}`,
    )
  }
  if (!accountInfo.owner.equals(StakeProgram.programId)) {
    throw new Error(
      `${address.toBase58()} is not a stake account because owner is ${
        accountInfo.owner
      } at ${connection.rpcEndpoint}`,
    )
  }
  const stakeState = deserializeStakeState(accountInfo.data)

  return await parseStakeAccountData(
    connection,
    {
      publicKey: address,
      account: {
        ...accountInfo,
        data: stakeState,
      },
    },
    currentEpoch,
  )
}

// https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L60
const STAKER_OFFSET = 12 // 4 for enum, 8 rent exempt reserve
const WITHDRAWER_OFFSET = 44 // 4 + 8 + staker pubkey
// https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L414
const VOTER_PUBKEY_OFFSET = 124 // 4 for enum + 120 for Meta

export async function findStakeAccountNoDataInfos({
  connection,
  staker,
  withdrawer,
  voter,
}: {
  connection: Provider | Connection | HasProvider
  staker?: PublicKey
  withdrawer?: PublicKey
  voter?: PublicKey
}): Promise<ProgramAccountInfoNoData[]> {
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
  if (voter) {
    filters.push({
      memcmp: {
        offset: VOTER_PUBKEY_OFFSET,
        bytes: voter.toBase58(),
      },
    })
  }

  return await getAccountInfoNoData({
    connection,
    programId: StakeProgram.programId,
    filters,
  })
}

export async function loadStakeAccounts({
  connection,
  addresses,
  currentEpoch,
}: {
  connection: Provider | Connection | HasProvider
  addresses: PublicKey[] | ProgramAccountInfoNoData[]
  currentEpoch?: number | BN
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
  const innerConnection = getConnection(connection)
  if (addresses.length === 0) {
    return []
  }
  addresses = addresses
    .map(d => (isWithPublicKey(d) ? d.publicKey : d))
    .map(d => d as PublicKey)
  const accounts = (
    await getMultipleAccounts({ connection: innerConnection, addresses })
  )
    .filter(d => d.account !== null)
    .map(async d => {
      assert(d.account !== null, 'findStakeAccounts: already filtered out')
      const stakeState = deserializeStakeState(d.account.data)
      return programAccountInfo(
        d.publicKey,
        d.account,
        await parseStakeAccountData(
          innerConnection,
          {
            publicKey: d.publicKey,
            account: { ...d.account, data: stakeState },
          },
          currentEpoch,
        ),
      )
    })
  return Promise.all(accounts)
}

export async function findStakeAccounts({
  connection,
  staker,
  withdrawer,
  voter,
  currentEpoch,
}: {
  connection: Provider | Connection | HasProvider
  staker?: PublicKey
  withdrawer?: PublicKey
  voter?: PublicKey
  currentEpoch?: BN | number
}): Promise<ProgramAccountInfo<StakeAccountParsed>[]> {
  const accountInfos = await findStakeAccountNoDataInfos({
    connection,
    staker,
    withdrawer,
    voter,
  })
  return await loadStakeAccounts({
    connection,
    addresses: accountInfos,
    currentEpoch,
  })
}

export async function getRentExemptStake(
  provider: Provider,
  rentExempt?: number,
): Promise<number> {
  return (
    rentExempt ??
    (await provider.connection.getMinimumBalanceForRentExemption(
      StakeProgram.space,
    ))
  )
}

function pubkeyOrNull(
  value?: ConstructorParameters<typeof PublicKey>[0] | null,
): PublicKey | null {
  return value === null || value === undefined ? null : new PublicKey(value)
}

function bnOrNull(
  value?: ConstructorParameters<typeof BN>[0] | null,
): BN | null {
  return value === null || value === undefined ? null : new BN(value)
}
