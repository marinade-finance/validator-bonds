import { parsePubkey, parseWalletOrPubkey } from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  fundBondInstruction,
  getConfig,
  getRentExemptStake,
  MARINADE_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import {
  Authorized,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  StakeProgram,
} from '@solana/web3.js'
import { getBondFromAddress } from '../utils'
import { FUND_BOND_WITH_SOL_LIMIT_UNITS } from '../../computeUnits'
import { BN } from 'bn.js'
import { failIfUnexpectedError } from './fundBond'

export function installFundBondWithSol(program: Command) {
  program
    .command('fund-bond-sol')
    .description(
      'Funding a bond account with amount SOL amount. ' +
        'The command creates a stake account, transfers SOLs to it and delegate it to bond.',
    )
    .argument(
      '<address>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .option(
      '--config <pubkey>',
      'The config account that the bond account is created under ' +
        '(optional; to derive bond address from vote account address) ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .requiredOption(
      '--amount <number>',
      'Number of SOLs to be funded to bond account.',
      n => parseFloat(n),
    )
    .option(
      '--from <keypair_or_ledger_or_keypair>',
      'A wallet address where the SOL is transferred from. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
          amount,
          from,
        }: {
          config?: Promise<PublicKey>
          amount: number
          from?: Promise<WalletInterface | PublicKey>
        },
      ) => {
        await manageFundBondWithSol({
          address: await address,
          config: await config,
          amount,
          from: await from,
        })
      },
    )
}

async function manageFundBondWithSol({
  address,
  config,
  amount,
  from,
}: {
  address: PublicKey
  config?: PublicKey
  amount: number
  from?: WalletInterface | PublicKey
}) {
  const {
    program,
    programId,
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

  const tx = await transaction(provider, wallet)
  const signers: (Signer | Wallet)[] = [wallet]

  from = from ?? wallet.publicKey
  if (instanceOfWallet(from)) {
    signers.push(from)
    from = from.publicKey
  }

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const bondAccountAddress = bondAccountData.publicKey
  config = bondAccountData.account.data.config
  const voteAccount = bondAccountData.account.data.voteAccount

  const configData = await getConfig(program, config)
  const rentExemptStake = await getRentExemptStake(provider)
  const minimalAmountToFund = configData.minimumStakeLamports.add(
    new BN(rentExemptStake),
  )
  const amountLamports = new BN(amount).mul(new BN(LAMPORTS_PER_SOL))
  if (amountLamports.lt(minimalAmountToFund)) {
    throw new Error(
      `Provided amount ${amount} SOL is lower than minimal amount ` +
        'that is permitted to be funded. Minimal is ' +
        `${minimalAmountToFund.toNumber() / LAMPORTS_PER_SOL} SOL. ` +
        'Please, use a bigger number of SOLs for funding.',
    )
  }
  if (amountLamports.toNumber() > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Provided amount ${amount} SOL cannot be safely converted ` +
        'to number of lamports. Please, use a lower number.',
    )
  }
  let stakeAccount: Keypair | PublicKey = Keypair.generate()
  signers.push(stakeAccount)
  stakeAccount = stakeAccount.publicKey
  const createStakeAccountIx = StakeProgram.createAccount({
    fromPubkey: from,
    stakePubkey: stakeAccount,
    authorized: new Authorized(from, from),
    lamports: amountLamports.toNumber(),
    lockup: undefined,
  })
  // error 0xc means not enough SOL to delegate the account
  // lamports param has to be rentExempt + 1 SOL as min delegation amount
  // normally it was 1 lamport, in new Solana versions it could be 1 SOL (SIMD that was not activated)
  const delegateStakeAccountIx = StakeProgram.delegate({
    stakePubkey: stakeAccount,
    authorizedPubkey: from,
    votePubkey: voteAccount,
  })
  const { instruction: fundBondIx, bondAccount } = await fundBondInstruction({
    program,
    bondAccount: bondAccountAddress,
    configAccount: config,
    voteAccount,
    stakeAccount,
    stakeAccountAuthority: from,
  })
  tx.add(createStakeAccountIx, delegateStakeAccountIx, fundBondIx)

  logger.info(
    `Funding bond account ${bondAccount.toBase58()} of vote account ${voteAccount.toBase58()} ` +
      ` with ${amount} SOL from wallet ${from.toBase58()}`,
  )
  try {
    await executeTx({
      connection: provider.connection,
      transaction: tx,
      errMessage: `'Failed to fund bond account ${bondAccount.toBase58()} with ${amount} from ${from.toBase58()}`,
      signers,
      logger,
      computeUnitLimit: FUND_BOND_WITH_SOL_LIMIT_UNITS,
      computeUnitPrice,
      simulate,
      printOnly,
      confirmOpts: confirmationFinality,
      confirmWaitTime,
      sendOpts: { skipPreflight },
    })
    logger.info(
      `Bond account ${bondAccount.toBase58()} successfully funded ` +
        `with amount ${amount} from ${from.toBase58()}`,
    )
  } catch (err) {
    await failIfUnexpectedError({
      err,
      logger,
      provider,
      config,
      programId,
      stakeAccount,
      bondAccount,
    })
  }
}