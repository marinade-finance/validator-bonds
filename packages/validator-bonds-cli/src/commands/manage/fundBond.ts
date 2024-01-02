import { parsePubkey } from '@marinade.finance/cli-common'
import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { parseSignerOrPubkey, setProgramIdByOwner } from '../../context'
import { transaction } from '@marinade.finance/anchor-common'
import { Wallet, executeTx } from '@marinade.finance/web3js-common'
import {
  CONFIG_ADDRESS,
  fundBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'

export function installFundBond(program: Command) {
  program
    .command('fund-bond')
    .description(
      'Funding a bond account with amount of SOL within a stake account.'
    )
    .argument(
      '[bond-account-address]',
      'Address of the bond account to be funded. ' +
        'When the address is not provided then this command requires ' +
        '--config and --vote-account options to be defined',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument bond-account-address is provided, used to derive the bond address) ' +
        'The config account that the bond is created under ' +
        `(default: ${CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument bond-account-address is provided, used to derive the bond address) ' +
        'Validator vote account that the bond is bound to',
      parsePubkey
    )
    .requiredOption(
      '--stake-account <pubkey>',
      'Stake account that is used to fund the bond account',
      parsePubkey
    )
    .option(
      '--stake-authority <keypair_or_ledger_or_pubkey>',
      'Stake account authority (probably the withdrawer authority) ' +
        'that is permitted to sign stake account authority changes. ' +
        '(default: wallet keypair)',
      parseSignerOrPubkey
    )
    .action(
      async (
        bondAccountAddress: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          stakeAccount,
          stakeAuthority,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          stakeAccount: Promise<PublicKey>
          stakeAuthority?: Promise<PublicKey | Keypair>
        }
      ) => {
        await manageFundBond({
          bondAccountAddress: await bondAccountAddress,
          config: await config,
          voteAccount: await voteAccount,
          stakeAccount: await stakeAccount,
          stakeAuthority: await stakeAuthority,
        })
      }
    )
}

async function manageFundBond({
  bondAccountAddress,
  config,
  voteAccount,
  stakeAccount,
  stakeAuthority,
}: {
  bondAccountAddress?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  stakeAccount: PublicKey
  stakeAuthority?: PublicKey | Keypair
}) {
  const { program, provider, logger, simulate, printOnly, wallet } =
    await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  stakeAuthority = stakeAuthority || wallet.publicKey
  if (stakeAuthority instanceof Keypair) {
    signers.push(stakeAuthority)
    stakeAuthority = stakeAuthority.publicKey
  }

  const { instruction, bondAccount } = await fundBondInstruction({
    program,
    bondAccount: bondAccountAddress,
    configAccount: config,
    validatorVoteAccount: voteAccount,
    stakeAccount,
    stakeAccountAuthority: stakeAuthority,
  })
  tx.add(instruction)

  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to fund bond account ${bondAccount.toBase58()}`,
    signers,
    logger,
    simulate,
    printOnly,
  })
  logger.info(
    `Bond account ${bondAccount.toBase58()} successfully funded ` +
      `with stake account ${stakeAccount.toBase58()}`
  )
}
