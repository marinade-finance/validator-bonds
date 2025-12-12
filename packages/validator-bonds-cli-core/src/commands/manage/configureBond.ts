import { CliCommandError } from '@marinade.finance/cli-common'
import {
  ProductTypes,
  configureBondInstruction,
  configureBondWithMintInstruction,
  configureCommissionProductInstruction,
  findBondProducts,
  initCommissionProductInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  instanceOfWallet,
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkeyOption,
  pubkey,
  transaction,
} from '@marinade.finance/web3js-1x'

import {
  CONFIGURE_BOND_CONFIG_COMMISSION_LIMIT_UNITS,
  CONFIGURE_BOND_LIMIT_UNITS,
  CONFIGURE_BOND_MINT_LIMIT_UNITS,
  INIT_BOND_CONFIG_COMMISSION_LIMIT_UNITS,
} from '../../computeUnits'
import { getCliContext } from '../../context'
import { getBondFromAddress } from '../../utils'

import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type {
  BondProduct,
  ValidatorBondsProgram,
} from '@marinade.finance/validator-bonds-sdk'
import type {
  Wallet as WalletInterface,
  Wallet,
} from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer, TransactionInstruction } from '@solana/web3.js'
import type BN from 'bn.js'
import type { Command } from 'commander'

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
      parseWalletOrPubkeyOption,
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
    .option(
      '--compute-unit-limit <number>',
      'Compute unit limit for the transaction (default value based on the operation type)',
      v => parseInt(v, 10),
    )
}

export async function manageConfigureBond({
  address,
  config,
  authority,
  withToken,
  newBondAuthority,
  cpmpe,
  maxStakeWanted,
  mevBps,
  blockBps,
  inflationBps,
  uniformBps,
  rentPayer,
  computeUnitLimit,
}: {
  address: PublicKey
  config: PublicKey
  authority?: WalletInterface | PublicKey
  withToken: boolean
  newBondAuthority?: PublicKey
  cpmpe?: BN
  maxStakeWanted?: BN
  mevBps?: BN | null
  blockBps?: BN | null
  inflationBps?: BN | null
  uniformBps?: BN | null
  rentPayer?: WalletInterface | PublicKey
  computeUnitLimit?: number
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
  } = getCliContext()

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const bondAccountAddress = bondAccountData.publicKey
  config = bondAccountData.account.data.config
  const voteAccount = bondAccountData.account.data.voteAccount

  let bondAccount: PublicKey
  let instruction: TransactionInstruction
  if (withToken) {
    authority = authority ?? wallet.publicKey
    computeUnitLimit = computeUnitLimit ?? CONFIGURE_BOND_MINT_LIMIT_UNITS
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
    authority = authority ?? bondAccountData.account.data.authority
    computeUnitLimit = computeUnitLimit ?? CONFIGURE_BOND_LIMIT_UNITS
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

  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  tx.add(instruction)

  rentPayer = rentPayer ?? authority

  if (
    mevBps !== undefined ||
    blockBps !== undefined ||
    inflationBps !== undefined ||
    uniformBps !== undefined
  ) {
    if (withToken) {
      throw CliCommandError.instance(
        'Configuring bond commission parameters is not supported when using bond token authorization. ' +
          'Please use authority authorization (without --with-token option) to configure bond commission parameters.',
      )
    }
    const bondProduct = await verifyCommissionBondProductExistence(
      program,
      bondAccount,
      logger,
    )
    if (!bondProduct) {
      const { instruction: commissionInitInstruction, bondProduct } =
        await initCommissionProductInstruction({
          program,
          bondAccount,
          configAccount: config,
          voteAccount: voteAccount ?? bondAccountData.account.data.voteAccount,
          authority,
          blockBps: blockBps ?? null,
          inflationBps: inflationBps ?? null,
          mevBps: mevBps ?? null,
          uniformBps,
          rentPayer,
        })
      logger.info(
        'To configure commission parameters, a commission bond configuration account will be initialized. ' +
          `To pay rent to create the commission bond configuration account the rent payer ${pubkey(rentPayer).toBase58()} is used.`,
      )
      logger.debug(
        `Initializing commission bond product: ${bondProduct.toBase58()}`,
      )
      tx.add(commissionInitInstruction)
      computeUnitLimit += INIT_BOND_CONFIG_COMMISSION_LIMIT_UNITS
      if (instanceOfWallet(rentPayer)) {
        signers.push(rentPayer)
        rentPayer = rentPayer.publicKey
      }
    } else {
      const { instruction: commissionConfigureInstruction, bondProduct } =
        await configureCommissionProductInstruction({
          program,
          bondAccount,
          configAccount: config,
          voteAccount: voteAccount ?? bondAccountData.account.data.voteAccount,
          authority,
          blockBps,
          inflationBps,
          mevBps,
          uniformBps,
        })
      logger.info(
        'To configure commission parameters, a commission bond configuration account will be initialized. ' +
          `To pay rent to create the commission bond configuration account the rent payer ${pubkey(rentPayer).toBase58()} is used.`,
      )
      logger.debug(
        `Initializing commission bond product: ${bondProduct.toBase58()}`,
      )
      tx.add(commissionConfigureInstruction)
      computeUnitLimit += CONFIGURE_BOND_CONFIG_COMMISSION_LIMIT_UNITS
    }
  }

  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

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

async function verifyCommissionBondProductExistence(
  program: ValidatorBondsProgram,
  bondAccount: PublicKey,
  logger: LoggerWrapper,
): Promise<BondProduct | undefined> {
  const product = await findBondProducts({
    program,
    bond: bondAccount,
    productType: ProductTypes.commission,
    logger,
  })
  if (product.length > 1) {
    throw CliCommandError.instance(
      `Multiple commission bond products (${product.map(p => p.publicKey.toBase58()).join(', ')}) found ` +
        `for bond account ${bondAccount.toBase58()}. This is unexpected as only one commission product should exist per bond account.`,
    )
  }
  return product[0]?.account
}
