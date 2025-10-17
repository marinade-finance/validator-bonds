import { CliCommandError } from '@marinade.finance/cli-common'
import {
  bondAddress,
  withdrawRequestAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { parsePubkeyOrPubkeyFromWallet } from '@marinade.finance/web3js-1x'

import { getCliContext } from '../context'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureShowBondAddress(program: Command): Command {
  return program
    .command('bond-address')
    .description(
      'From provided vote account address derives the bond account address',
    )
    .argument(
      '<address>',
      'Address of the vote account to get derived bond account address',
      parsePubkeyOrPubkeyFromWallet,
    )
}

export function showBondAddress({
  address,
  config,
}: {
  address: PublicKey
  config: PublicKey
}) {
  const { program, logger } = getCliContext()

  try {
    const [bondAddr, bondBump] = bondAddress(config, address, program.programId)
    logger.debug(
      'Deriving bond account address from vote account: ' +
        `${address.toBase58()}, config: ${config.toBase58()}, programId: ${program.programId.toBase58()}`,
    )
    const [withdrawRequestAddr, withdrawRequestBump] = withdrawRequestAddress(
      bondAddr,
      program.programId,
    )
    logger.debug(
      'Deriving withdraw request account address from bond account: ' +
        `${bondAddr.toBase58()}, programId: ${program.programId.toBase58()}`,
    )
    console.log(
      `Bond account address: ${bondAddr.toBase58()} [bump: ${bondBump}], withdraw request address: ${withdrawRequestAddr.toBase58()} [bump: ${withdrawRequestBump}]`,
    )
  } catch (err) {
    throw new CliCommandError({
      valueName: 'voteAccount|--config',
      value: `${address.toBase58()}}|${config.toBase58()}}`,
      msg: 'Error while deriving bond account address from vote account address',
      cause: err as Error,
    })
  }
}
