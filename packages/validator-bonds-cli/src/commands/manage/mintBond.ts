import { parsePubkey, parseWalletOrPubkey } from '@marinade.finance/cli-common'
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
  MARINADE_CONFIG_ADDRESS,
  mintBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { getBondFromAddress } from '../utils'
import { MINT_BOND_LIMIT_UNITS } from '../../computeUnits'

export function installMintBond(program: Command) {
  program
    .command('mint-bond')
    .description(
      'Mint a Validator Bond token, providing a means to configure the bond account ' +
        'without requiring a direct signature for the on-chain transaction. ' +
        'The workflow is as follows: first, use this "mint-bond" to mint a bond token ' +
        'to the validator identity public key. Next, transfer the token to any account desired. ' +
        'Finally, utilize the command "configure-bond --with-token" to configure the bond account.'
    )
    .argument(
      '[address]',
      'Address of the bond account to configure. Provide: bond or vote account address. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument bond-account-address is provided) ' +
        'The config account that the bond is created under ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument bond-account-address is provided) ' +
        'Validator vote account that the bond is bound to',
      parsePubkey
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the mint token account creation (default: wallet keypair)',
      parseWalletOrPubkey
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          rentPayer,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          rentPayer?: Promise<WalletInterface | PublicKey>
        }
      ) => {
        await manageMintBond({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          rentPayer: await rentPayer,
        })
      }
    )
}

async function manageMintBond({
  address,
  config = MARINADE_CONFIG_ADDRESS,
  voteAccount,
  rentPayer,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
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
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  rentPayer = rentPayer ?? wallet.publicKey
  if (instanceOfWallet(rentPayer)) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
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

  const { instruction, bondAccount, validatorIdentity, bondMint } =
    await mintBondInstruction({
      program,
      bondAccount: bondAccountAddress,
      configAccount: config,
      voteAccount,
      rentPayer,
    })
  tx.add(instruction)

  logger.info(
    `Mint bond ${bondAccount.toBase58()} token ${bondMint.toBase58()} ` +
      `for validator identity ${validatorIdentity.toBase58()}`
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to mint token for bond ${bondAccount.toBase58()}`,
    signers,
    logger,
    computeUnitLimit: MINT_BOND_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Bond ${bondAccount.toBase58()} token ${bondMint.toBase58()} was minted successfully`
  )
}
