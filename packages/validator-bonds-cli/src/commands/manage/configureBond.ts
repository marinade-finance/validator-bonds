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
  MARINADE_CONFIG_ADDRESS,
  configureBondInstruction,
  configureBondWithMintInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { getBondFromAddress } from '../utils'
import {
  CONFIGURE_BOND_LIMIT_UNITS,
  CONFIGURE_BOND_MINT_LIMIT_UNITS,
} from '../../computeUnits'

export function installConfigureBond(program: Command) {
  program
    .command('configure-bond')
    .description('Configure existing bond account.')
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
      '--authority <keypair_or_ledger_or_pubkey>',
      'Authority that is permitted to do changes in bonds account. ' +
        'It is either the authority defined in bonds account OR ' +
        'vote account validator identity OR owner of bond configuration token (see "mint-bond" command). ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey
    )
    .option(
      '--with-token',
      'Use the bond token to authorize the transaction. If this option is enabled, ' +
        'it requires the "--authority" to be the owner of the bond token and possession of the bond token at the ATA account.',
      false
    )
    .option(
      '--bond-authority <pubkey>',
      'New value of "bond authority" that is permitted to operate with the bond account.',
      parsePubkeyOrPubkeyFromWallet
    )

    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          withToken,
          bondAuthority,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withToken: boolean
          bondAuthority?: Promise<PublicKey>
        }
      ) => {
        await manageConfigureBond({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          withToken,
          newBondAuthority: await bondAuthority,
        })
      }
    )
}

async function manageConfigureBond({
  address,
  config = MARINADE_CONFIG_ADDRESS,
  voteAccount,
  authority,
  withToken,
  newBondAuthority,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  withToken: boolean
  newBondAuthority?: PublicKey
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
    }))
  }
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
    computeUnitLimit,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
  })
  logger.info(`Bond account ${bondAccount.toBase58()} successfully configured`)
}
