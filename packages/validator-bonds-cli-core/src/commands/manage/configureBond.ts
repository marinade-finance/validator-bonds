import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { PublicKey, Signer, TransactionInstruction } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  configureBondInstruction,
  configureBondWithMintInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { getBondFromAddress } from '../../utils'
import {
  CONFIGURE_BOND_LIMIT_UNITS,
  CONFIGURE_BOND_MINT_LIMIT_UNITS,
} from '../../computeUnits'
import BN from 'bn.js'

export function configureConfigureBond(program: Command): Command {
  return program
    .command('configure-bond')
    .description('Configure existing bond account.')
    .argument(
      '<address>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .option(
      '--authority <keypair_or_ledger_or_pubkey>',
      'Authority that is permitted to do changes in bonds account. ' +
        'It is either the authority defined in bonds account OR ' +
        'vote account validator identity OR owner of bond configuration token (see "mint-bond" command). ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .option(
      '--with-token',
      'Use the bond token to authorize the transaction. If this option is enabled, ' +
        'it requires the "--authority" to be the owner of the bond token and possession of the bond token at the ATA account.',
      false,
    )
    .option(
      '--bond-authority <pubkey>',
      'New value of "bond authority" that is permitted to operate with the bond account.',
      parsePubkeyOrPubkeyFromWallet,
    )
  // MIP.10 removed maxStakeWanted from bidding auction, institutional staking does not support this option
  // .option(
  //   '--max-stake-wanted <number>',
  //   'New value of maximum stake amount, in lamports, the validator wants to be delegated to them. ' +
  //     'The actual amount delegated will depend on the auction and may be equal to or less than this value.',
  //   value => toBN(value),
  // )
}

export async function manageConfigureBond({
  address,
  config,
  voteAccount,
  authority,
  withToken,
  newBondAuthority,
  cpmpe,
  maxStakeWanted,
}: {
  address: PublicKey
  config: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  withToken: boolean
  newBondAuthority?: PublicKey
  cpmpe?: BN
  maxStakeWanted?: BN
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

  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
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

  let bondAccount: PublicKey
  let instruction: TransactionInstruction
  let computeUnitLimit: number
  if (withToken) {
    computeUnitLimit = CONFIGURE_BOND_MINT_LIMIT_UNITS
    ;({ instruction, bondAccount } = await configureBondWithMintInstruction({
      program,
      bondAccount: bondAccountAddress,
      configAccount: config,
      voteAccount,
      tokenAuthority: authority,
      newBondAuthority,
      newCpmpe: cpmpe,
      newMaxStakeWanted: maxStakeWanted,
    }))
  } else {
    computeUnitLimit = CONFIGURE_BOND_LIMIT_UNITS
    ;({ instruction, bondAccount } = await configureBondInstruction({
      program,
      bondAccount: bondAccountAddress,
      configAccount: config,
      voteAccount,
      authority,
      newBondAuthority,
      newCpmpe: cpmpe,
      newMaxStakeWanted: maxStakeWanted,
    }))
  }
  tx.add(instruction)

  logger.info(
    `Configuring bond account ${bondAccount.toBase58()} with authority ${authority.toBase58()} (finalization may take seconds)`,
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to configure bond account ${bondAccount.toBase58()}`,
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
  logger.info(`Bond account ${bondAccount.toBase58()} successfully configured`)
}
