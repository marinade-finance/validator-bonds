import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  fundBondInstruction,
  MARINADE_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { getBondFromAddress } from '../utils'

export function installFundBond(program: Command) {
  program
    .command('fund-bond')
    .description(
      'Funding a bond account with amount of SOL within a stake account.'
    )
    .argument(
      '[address]',
      'Address of the bond account to be funded. Provide: bond or vote account address. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument bond-account-address is NOT provided, used to derive the bond address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument bond-account-address is NOT provided, used to derive the bond address) ' +
        'Validator vote account that the bond is bound to',
      parsePubkeyOrPubkeyFromWallet
    )
    .requiredOption(
      '--stake-account <pubkey>',
      'Stake account that is used to fund the bond account',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--stake-authority <keypair_or_ledger_or_pubkey>',
      'Stake account authority (probably the withdrawer authority) ' +
        'that is permitted to sign stake account authority changes. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          stakeAccount,
          stakeAuthority,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          stakeAccount: Promise<PublicKey>
          stakeAuthority?: Promise<WalletInterface | PublicKey>
        }
      ) => {
        await manageFundBond({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          stakeAccount: await stakeAccount,
          stakeAuthority: await stakeAuthority,
        })
      }
    )
}

async function manageFundBond({
  address,
  config,
  voteAccount,
  stakeAccount,
  stakeAuthority,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  stakeAccount: PublicKey
  stakeAuthority?: WalletInterface | PublicKey
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

  stakeAuthority = stakeAuthority ?? wallet.publicKey
  if (instanceOfWallet(stakeAuthority)) {
    signers.push(stakeAuthority)
    stakeAuthority = stakeAuthority.publicKey
  }

  let bondAccountAddress = address
  if (address !== undefined) {
    const bondAccountData = await getBondFromAddress({
      program,
      address: address,
      config,
      logger,
    })
    bondAccountAddress = bondAccountData.publicKey
    config = bondAccountData.account.data.config
    voteAccount = bondAccountData.account.data.voteAccount
  }

  const { instruction, bondAccount } = await fundBondInstruction({
    program,
    bondAccount: bondAccountAddress,
    configAccount: config,
    voteAccount,
    stakeAccount,
    stakeAccountAuthority: stakeAuthority,
  })
  tx.add(instruction)

  logger.info(`Funding bond account ${bondAccount.toBase58()}`)
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to fund bond account ${bondAccount.toBase58()}`,
    signers,
    logger,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Bond account ${bondAccount.toBase58()} successfully funded ` +
      `with stake account ${stakeAccount.toBase58()}`
  )
}
