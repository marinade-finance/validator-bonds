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
  initWithdrawRequestInstruction,
  MARINADE_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import BN from 'bn.js'
import { getBondFromAddress } from '../utils'
import { INIT_WITHDRAW_REQUEST_LIMIT_UNITS } from '../../computeUnits'

export function installInitWithdrawRequest(program: Command) {
  program
    .command('init-withdraw-request')
    .description(
      'Initializing withdrawal by creating a request ticket. ' +
        'The withdrawal request ticket is used to indicate a desire to withdraw the specified amount ' +
        'of lamports after the lockup period expires.'
    )
    .argument(
      '[address]',
      'Address of the bond account to withdraw funds from. Provide: bond or vote account address. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, used to derive the bond address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument "address" is NOT provided, used to derive the bond address) ' +
        'Validator vote account that the bond is bound to',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--authority <keypair_or_ledger_or_pubkey>',
      'Authority that is permitted to do changes in the bond account. ' +
        'It is either the authority defined in the bond account or ' +
        'vote account validator identity that the bond account is connected to. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey
    )
    .requiredOption(
      '--amount <lamports_number>',
      'Number of lamports to withdraw from the bond.',
      v => new BN(v)
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseWalletOrPubkey
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          amount,
          rentPayer,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          amount: BN
          rentPayer?: Promise<WalletInterface | PublicKey>
        }
      ) => {
        await manageInitWithdrawRequest({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          amount,
          rentPayer: await rentPayer,
        })
      }
    )
}

async function manageInitWithdrawRequest({
  address,
  config,
  voteAccount,
  authority,
  amount,
  rentPayer,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  amount: BN
  rentPayer?: WalletInterface | PublicKey
}) {
  const {
    program,
    provider,
    logger,
    computeUnitPrice,
    simulate,
    printOnly,
    wallet,
    confirmationFinality,
    confirmWaitTime,
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  rentPayer = rentPayer ?? wallet.publicKey
  if (instanceOfWallet(rentPayer)) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }
  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
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

  const { instruction, bondAccount, withdrawRequestAccount } =
    await initWithdrawRequestInstruction({
      program,
      bondAccount: bondAccountAddress,
      configAccount: config,
      voteAccount,
      authority,
      amount,
      rentPayer,
    })
  tx.add(instruction)

  logger.info(
    `Initializing withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount.toBase58()}`
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `Failed to initialize withdraw request ${withdrawRequestAccount.toBase58()}`,
    signers,
    logger,
    computeUnitLimit: INIT_WITHDRAW_REQUEST_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
  })
  logger.info(
    `Withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount.toBase58()} successfully initialized`
  )
}
