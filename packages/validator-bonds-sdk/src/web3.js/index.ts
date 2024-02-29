import { Idl, Program, Provider } from '@coral-xyz/anchor'
import { Connection } from '@solana/web3.js'

export * from './stakeAccount'
export * from './voteAccount'
export * from './tokenMetadata'

export function getConnection<IDL extends Idl = Idl>(
  providerOrConnection: Provider | Connection | Program<IDL>
): Connection {
  const connection =
    providerOrConnection instanceof Program
      ? providerOrConnection.provider
      : providerOrConnection
  return connection instanceof Connection ? connection : connection.connection
}
