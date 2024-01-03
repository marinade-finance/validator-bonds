import { parsePubkey, parsePubkeyOrKeypair } from '@marinade.finance/cli-common'
import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import { transaction } from '@marinade.finance/anchor-common'
import { Wallet, executeTx } from '@marinade.finance/web3js-common'
import {
  CONFIG_ADDRESS,
  initBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { toHundredsBps } from '@marinade.finance/validator-bonds-sdk/src/utils'

export function installInitBond(program: Command) {
  program
    .command('init-bond')
    .description('Create a new bond account.')
    .option(
      '--config <pubkey>',
      'Validator Bond config account that the bond is created under ' +
        `(default: ${CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .requiredOption(
      '--vote-account <pubkey>',
      'Validator vote account that this bond is bound to',
      parsePubkey
    )
    .option(
      '--validator-identity <keypair_or_pubkey>',
      'Validator identity linked to the vote account. ' +
        'To create the bond the signature of the validator identity is needed (default: wallet keypair)',
      parsePubkeyOrKeypair
    )
    .option(
      '--bond-authority <pubkey>',
      'Authority that is permitted to operate with bond account (default: wallet pubkey)',
      parsePubkey
    )
    .option(
      '--revenue-share <number>',
      'Revenue share in percents (the precision is 1/10000 of the percent)',
      toHundredsBps,
      0
    )
    .option(
      '--rent-payer <keypair_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parsePubkeyOrKeypair
    )

    .action(
      async ({
        config,
        voteAccount,
        validatorIdentity,
        bondAuthority,
        revenueShare,
        rentPayer,
      }: {
        config?: Promise<PublicKey>
        voteAccount: Promise<PublicKey>
        validatorIdentity?: Promise<PublicKey | Keypair>
        bondAuthority: Promise<PublicKey>
        revenueShare: number
        rentPayer?: Promise<PublicKey | Keypair>
      }) => {
        await manageInitBond({
          config: await config,
          voteAccount: await voteAccount,
          validatorIdentity: await validatorIdentity,
          bondAuthority: await bondAuthority,
          revenueShare: revenueShare,
          rentPayer: await rentPayer,
        })
      }
    )
}

async function manageInitBond({
  config = CONFIG_ADDRESS,
  voteAccount,
  validatorIdentity,
  bondAuthority,
  revenueShare,
  rentPayer,
}: {
  config?: PublicKey
  voteAccount: PublicKey
  validatorIdentity?: PublicKey | Keypair
  bondAuthority: PublicKey
  revenueShare: number
  rentPayer?: PublicKey | Keypair
}) {
  const { program, provider, logger, simulate, printOnly, wallet } =
    await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  rentPayer = rentPayer || wallet.publicKey
  if (rentPayer instanceof Keypair) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }
  validatorIdentity = validatorIdentity || wallet.publicKey
  if (validatorIdentity instanceof Keypair) {
    signers.push(validatorIdentity)
    validatorIdentity = validatorIdentity.publicKey
  }

  bondAuthority = bondAuthority || wallet.publicKey

  const { instruction, bondAccount } = await initBondInstruction({
    program,
    configAccount: config,
    bondAuthority,
    validatorVoteAccount: voteAccount,
    validatorIdentity,
    revenueShareHundredthBps: revenueShare,
    rentPayer,
  })
  tx.add(instruction)

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
  })
  logger.info(
    `Bond account ${bondAccount.toBase58()} of config ${config.toBase58()} successfully created`
  )
}
