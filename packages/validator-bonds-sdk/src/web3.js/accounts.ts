import { Idl, Program, Provider } from '@coral-xyz/anchor'
import { chunkArray } from '@marinade.finance/ts-common'
import {
  AccountInfo,
  Connection,
  GetProgramAccountsFilter,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js'
import { getConnection } from '.'

export type ProgramAccountInfo<T> = {
  publicKey: PublicKey
  account: AccountInfo<T>
}

export function programAccountInfo<T>(
  publicKey: PublicKey,
  account: AccountInfo<Buffer | ParsedAccountData>,
  data: T
): ProgramAccountInfo<T> {
  return { publicKey, account: { ...account, data } }
}

export type ProgramAccountNullable<T> = {
  publicKey: PublicKey
  account: T | null
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
}): Promise<ProgramAccountNullable<AccountInfo<Buffer> | null>[]> {
  connection = getConnection(connection)
  const result: ProgramAccountNullable<AccountInfo<Buffer> | null>[] = []
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

export async function getAccountAddresses<IDL extends Idl = Idl>({
  connection,
  programId,
  filters,
}: {
  connection: Program<IDL> | Connection | Provider
  programId: PublicKey
  filters?: GetProgramAccountsFilter[] | undefined
}): Promise<PublicKey[]> {
  connection = getConnection(connection)
  const accounts = await connection.getProgramAccounts(programId, {
    dataSlice: { length: 0, offset: 0 },
    filters,
  })
  return accounts.map(account => account.pubkey)
}
