import * as anchor from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram } from '../../src'
import { Commitment, Connection } from '@solana/web3.js'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

export async function initTest(commitment?: Commitment): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorExtendedProvider
}> {
  const anchorProvider = AnchorExtendedProvider.env()
  let connection = anchorProvider.connection
  // fix for IPv6 default resolution
  if (
    anchorProvider.connection.rpcEndpoint.includes('::1') ||
    anchorProvider.connection.rpcEndpoint.includes('0.0.0.0')
  ) {
    connection = new Connection(
      'http://127.0.0.1:8899',
      commitment ?? anchorProvider.connection.commitment
    )
  } else {
    connection = new Connection(
      anchorProvider.connection.rpcEndpoint,
      commitment ?? anchorProvider.connection.commitment
    )
  }
  const provider = new AnchorExtendedProvider(
    connection,
    anchorProvider.wallet,
    { ...anchorProvider.opts, skipPreflight: true }
  )
  anchor.setProvider(provider)
  return { program: getProgram(provider), provider }
}
