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
  getVoteAccount,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  MARINADE_CONFIG_ADDRESS,
  initBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'

export function installInitBond(program: Command) {
  program
    .command('init-bond')
    .description('Create a new bond account.')
    .option(
      '--config <pubkey>',
      'The config account that the bond is created under. ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .requiredOption(
      '--vote-account <pubkey>',
      'Validator vote account that this bond is bound to',
      parsePubkey
    )
    .option(
      '--validator-identity <keypair_or_ledger_or_pubkey>',
      'Validator identity linked to the vote account. ' +
        'Permission-ed execution requires the validator identity signature, possible possible to configure --bond-authority. ' +
        'Permission-less execution requires no signature, bond account configuration is possible later with validator identity signature (default: NONE)',
      parseWalletOrPubkey
    )
    .option(
      '--bond-authority <pubkey>',
      'Authority that is permitted to operate with bond account. ' +
        'Only possible to set in permission-ed mode (see above, default: vote account validator identity)',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseWalletOrPubkey
    )
    .action(
      async ({
        config,
        voteAccount,
        validatorIdentity,
        bondAuthority,
        rentPayer,
      }: {
        config?: Promise<PublicKey>
        voteAccount: Promise<PublicKey>
        validatorIdentity?: Promise<WalletInterface | PublicKey>
        bondAuthority: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
      }) => {
        await manageInitBond({
          config: await config,
          voteAccount: await voteAccount,
          validatorIdentity: await validatorIdentity,
          bondAuthority: await bondAuthority,
          rentPayer: await rentPayer,
        })
      }
    )
}

async function manageInitBond({
  config = MARINADE_CONFIG_ADDRESS,
  voteAccount,
  validatorIdentity,
  bondAuthority,
  rentPayer,
}: {
  config?: PublicKey
  voteAccount: PublicKey
  validatorIdentity?: WalletInterface | PublicKey
  bondAuthority: PublicKey
  rentPayer?: WalletInterface | PublicKey
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

  rentPayer = rentPayer ?? wallet.publicKey
  if (instanceOfWallet(rentPayer)) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }
  if (instanceOfWallet(validatorIdentity)) {
    signers.push(validatorIdentity)
    validatorIdentity = validatorIdentity.publicKey
  }

  if (bondAuthority === undefined) {
    // when not defined the bondAuthority is the validator identity
    const voteAccountData = await getVoteAccount(provider, voteAccount)
    bondAuthority = voteAccountData.account.data.nodePubkey
  }

  const { instruction, bondAccount } = await initBondInstruction({
    program,
    configAccount: config,
    bondAuthority,
    voteAccount,
    validatorIdentity,
    rentPayer,
  })
  tx.add(instruction)

  logger.info(
    `Initializing bond account ${bondAccount.toBase58()} (finalization may take seconds)`
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage:
      `'Failed to init bond account ${bondAccount.toBase58()}` +
      ` of config ${config.toBase58()}`,
    signers,
    logger,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Bond account ${bondAccount.toBase58()} of config ${config.toBase58()} successfully created`
  )
}
