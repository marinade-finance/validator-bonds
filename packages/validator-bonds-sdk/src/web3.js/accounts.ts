import { Idl, Program, Provider, ProgramAccount } from '@coral-xyz/anchor'
import { chunkArray } from '@marinade.finance/ts-common'
import {
  AccountInfo,
  Connection,
  GetProgramAccountsFilter,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js'
import { getConnection } from '.'

export function isWithPublicKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any
): account is { publicKey: PublicKey } {
  return (
    account !== undefined &&
    account.publicKey !== undefined &&
    account.publicKey !== null
  )
}

export type ProgramAccountInfo<T> = ProgramAccount<AccountInfo<T>>
export type ProgramAccountInfoNullable<T> =
  ProgramAccount<AccountInfo<T> | null>
export type ProgramAccountInfoNoData = ProgramAccount<AccountInfo<undefined>>

export function programAccountInfo<T>(
  publicKey: PublicKey,
  account: AccountInfo<Buffer | ParsedAccountData>,
  data: T
): ProgramAccountInfo<T> {
  return { publicKey, account: { ...account, data } }
}

export type ProgramAccountWithInfoNullable<T> = {
  publicKey: PublicKey
  account: T | null
  accountInfo: AccountInfo<Buffer> | null
}

export async function getMultipleAccounts<IDL extends Idl = Idl>({
  connection,
  addresses,
}: {
  connection: Program<IDL> | Connection | Provider
  addresses: PublicKey[]
}): Promise<ProgramAccountInfoNullable<Buffer>[]> {
  if (addresses === undefined || addresses.length === 0) {
    return []
  }
  connection = getConnection(connection)
  const result: ProgramAccountInfoNullable<Buffer>[] = []
  // getMultipleAccounts should limit by 100 of addresses, see doc https://solana.com/docs/rpc/http/getmultipleaccounts
  for (const addressesChunked of chunkArray(addresses, 100)) {
    const fetchedRecords =
      await connection.getMultipleAccountsInfo(addressesChunked)
    for (const [index, fetchedRecord] of fetchedRecords.entries()) {
      result.push({
        publicKey: addressesChunked[index],
        account: fetchedRecord,
      })
    }
  }
  return result
}

export async function getAccountInfoNoData<IDL extends Idl = Idl>({
  connection,
  programId,
  filters,
}: {
  connection: Program<IDL> | Connection | Provider
  programId: PublicKey
  filters?: GetProgramAccountsFilter[] | undefined
}): Promise<ProgramAccountInfoNoData[]> {
  connection = getConnection(connection)
  const accounts = await connection.getProgramAccounts(programId, {
    dataSlice: { length: 0, offset: 0 },
    filters,
  })
  return accounts.map(d => ({
    publicKey: d.pubkey,
    account: {
      executable: d.account.executable,
      owner: d.account.owner,
      lamports: d.account.lamports,
      rentEpoch: d.account.rentEpoch,
      data: undefined,
    },
  }))
}

export async function getAccountInfoAddresses<IDL extends Idl = Idl>({
  connection,
  programId,
  filters,
}: {
  connection: Program<IDL> | Connection | Provider
  programId: PublicKey
  filters?: GetProgramAccountsFilter[] | undefined
}): Promise<PublicKey[]> {
  const accounts = await getAccountInfoNoData({
    connection,
    programId,
    filters,
  })
  return accounts.map(d => d.publicKey)
}
