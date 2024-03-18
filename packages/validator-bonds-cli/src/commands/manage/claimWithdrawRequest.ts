import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  instanceOfWallet,
  transaction,
  splitAndExecuteTx,
} from '@marinade.finance/web3js-common'
import {
  MARINADE_CONFIG_ADDRESS,
  orchestrateWithdrawDeposit,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { getWithdrawRequestFromAddress } from '../utils'
import { CLAIM_WITHDRAW_REQUEST_LIMIT_UNITS } from '../../computeUnits'

export function installClaimWithdrawRequest(program: Command) {
  program
    .command('claim-withdraw-request')
    .description(
      'Claiming an existing withdrawal request for an existing on-chain account, ' +
        'where the lockup period has expired. Withdrawing funds involves transferring ownership ' +
        'of a funded stake account to the specified "--withdrawer" public key. ' +
        'To withdraw, the authority signature of the bond account is required, specified by the "--authority" parameter (default wallet).'
    )
    .argument(
      '[address]',
      'Address of the withdrawal request account to claim. Provide: withdraw request or bond or vote account address.' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
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
    .option(
      '--withdrawer <pubkey>',
      'Pubkey to be new owner (withdrawer authority) ' +
        'of the stake accounts that are taken out of the Validator Bonds (default: wallet publickey)',
      parsePubkey
    )
    .option(
      '--split-stake-rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the split stake account creation. ' +
        'The split stake account is needed when the amount of lamports in the --stake-account ' +
        'is greater than the amount of lamports defined within the existing withdraw request account, ' +
        'then the splitted stake account remains under bond as funded (default: wallet keypair)',
      parseWalletOrPubkey
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          withdrawer,
          splitStakeRentPayer,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withdrawer?: Promise<PublicKey>
          splitStakeRentPayer?: Promise<WalletInterface | PublicKey>
        }
      ) => {
        await manageClaimWithdrawRequest({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          withdrawer: await withdrawer,
          splitStakeRentPayer: await splitStakeRentPayer,
        })
      }
    )
}

async function manageClaimWithdrawRequest({
  address,
  config,
  voteAccount,
  authority,
  withdrawer,
  splitStakeRentPayer,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  withdrawer?: PublicKey
  splitStakeRentPayer?: WalletInterface | PublicKey
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

  splitStakeRentPayer = splitStakeRentPayer ?? wallet.publicKey
  if (instanceOfWallet(splitStakeRentPayer)) {
    signers.push(splitStakeRentPayer)
    splitStakeRentPayer = splitStakeRentPayer.publicKey
  }
  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  withdrawer = withdrawer ?? wallet.publicKey

  let bondAccount: PublicKey | undefined = undefined
  let withdrawRequestAddress = address
  if (address !== undefined) {
    const withdrawRequestAccountData = await getWithdrawRequestFromAddress({
      program,
      address: address,
      config,
      logger,
    })
    withdrawRequestAddress = withdrawRequestAccountData.publicKey
    voteAccount = withdrawRequestAccountData.account.data.voteAccount
    bondAccount = withdrawRequestAccountData.account.data.bond
  }

  const {
    instructions,
    withdrawRequestAccount,
    stakeAccount,
    splitStakeAccount,
  } = await orchestrateWithdrawDeposit({
    program,
    withdrawRequestAccount: withdrawRequestAddress,
    bondAccount,
    voteAccount,
    configAccount: config,
    authority,
    withdrawer,
    splitStakeRentPayer,
  })
  signers.push(splitStakeAccount)
  tx.add(...instructions)
  console.log(
    'signers',
    signers.map(s => s.publicKey.toBase58())
  )

  logger.info(
    `Claiming withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} with stake account ${stakeAccount.toBase58()}`
  )
  await splitAndExecuteTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `Failed to claim withdraw request ${withdrawRequestAccount.toBase58()}`,
    signers,
    logger,
    computeUnitLimit: CLAIM_WITHDRAW_REQUEST_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
  })
  logger.info(
    `Withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} successfully claimed`
  )
}
