import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  CONFIG_ADDRESS,
  configureBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { toHundredsBps } from '@marinade.finance/validator-bonds-sdk/src/utils'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'

export function installConfigureBond(program: Command) {
  program
    .command('configure-bond')
    .description('Configure existing bond account.')
    .argument(
      '[bond-account-address]',
      'Address of the bond account to configure. ' +
        'When not provided the command requires defined --config and --vote-account options',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument bond-account-address is provided) ' +
        'The config account that the bond is created under ' +
        `(default: ${CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument bond-account-address is provided) ' +
        'Validator vote account that the bond is bound to',
      parsePubkey
    )
    .option(
      '--authority <keypair_or_ledger_or_pubkey>',
      'Authority that is permitted to do changes in bonds account. ' +
        'It is either the authority defined in bonds account or ' +
        'vote account validator identity that the bond account is connected to. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey
    )
    .option(
      '--bond-authority <pubkey>',
      'New value of authority that is permitted to operate with bond account.',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--revenue-share <number>',
      'New value of the revenue share in percents (the precision is 1/10000 of the percent, use e.g. 1.0001).',
      toHundredsBps
    )

    .action(
      async (
        bondAccountAddress: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          bondAuthority,
          revenueShare,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          bondAuthority?: Promise<PublicKey>
          revenueShare?: number
        }
      ) => {
        await manageConfigureBond({
          bondAccountAddress: await bondAccountAddress,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          newBondAuthority: await bondAuthority,
          newRevenueShareHundredthBps: revenueShare,
        })
      }
    )
}

async function manageConfigureBond({
  bondAccountAddress,
  config = CONFIG_ADDRESS,
  voteAccount,
  authority,
  newBondAuthority,
  newRevenueShareHundredthBps,
}: {
  bondAccountAddress?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  newBondAuthority?: PublicKey
  newRevenueShareHundredthBps?: number
}) {
  const {
    program,
    provider,
    logger,
    simulate,
    printOnly,
    wallet,
    confirmationFinality,
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  const { instruction, bondAccount } = await configureBondInstruction({
    program,
    bondAccount: bondAccountAddress,
    configAccount: config,
    validatorVoteAccount: voteAccount,
    authority,
    newRevenueShareHundredthBps,
    newBondAuthority,
  })
  tx.add(instruction)

  logger.info(
    `Configuring bond account ${bondAccount.toBase58()} (finalization may take seconds)`
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to configure bond account ${bondAccount.toBase58()}`,
    signers,
    logger,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(`Bond account ${bondAccount.toBase58()} successfully configured`)
}
