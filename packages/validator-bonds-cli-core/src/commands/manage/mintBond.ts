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
import { mintBondInstruction } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { getBondFromAddress } from '../../utils'
import { MINT_BOND_LIMIT_UNITS } from '../../computeUnits'

export function configureMintBond(program: Command) {
  return program
    .command('mint-bond')
    .description(
      'Mint a Validator Bond token, providing a means to configure the bond account ' +
        'without requiring a direct signature for the on-chain transaction. ' +
        'The workflow is as follows: first, use this "mint-bond" to mint a bond token ' +
        'to the validator identity public key. Next, transfer the token to any account desired. ' +
        'Finally, utilize the command "configure-bond --with-token" to configure the bond account.',
    )
    .argument(
      '<address>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .option(
      '--rent-payer <keypair_or_ledger_orl_pubkey>',
      'Rent payer for the mint token account creation (default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .option(
      '--compute-unit-limit <number>',
      'Compute unit limit for the transaction (default value based on the operation type)',
      v => parseInt(v, 10),
      MINT_BOND_LIMIT_UNITS,
    )
}

export async function manageMintBond({
  address,
  config,
  voteAccount,
  rentPayer,
  computeUnitLimit,
}: {
  address: PublicKey
  config: PublicKey
  voteAccount?: PublicKey
  rentPayer?: WalletInterface | PublicKey
  computeUnitLimit: number
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
    skipPreflight,
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  rentPayer = rentPayer ?? wallet.publicKey
  if (instanceOfWallet(rentPayer)) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const bondAccountAddress = bondAccountData.publicKey
  config = bondAccountData.account.data.config
  voteAccount = bondAccountData.account.data.voteAccount

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
    `Minting bond ${bondAccount.toBase58()} token ${bondMint.toBase58()} ` +
      `for validator identity ${validatorIdentity.toBase58()}`,
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to mint token for bond ${bondAccount.toBase58()}`,
    signers,
    logger,
    computeUnitLimit,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
    sendOpts: { skipPreflight },
  })
  logger.info(
    `Bond ${bondAccount.toBase58()} token ${bondMint.toBase58()} was minted successfully`,
  )
}
