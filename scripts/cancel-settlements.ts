#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Cancels validator-bonds Settlement accounts listed in a JSON file using the operational (operator) wallet.
// Dry-run by default (simulates each cancel); pass --execute to actually send.
// Pass --inspect for a read-only diagnostic of the split-rent refund stake accounts (no tx built).
// Pass --topup to prepend an atomic SystemProgram.transfer (fee-payer -> funded stake account) covering the
//   split-rent shortfall, so settlements whose stake account lacks withdrawable lamports become cancelable.
// Pass --reset to, after each cancel, send follow-up resetStake tx(s) returning the dangling funded stake
//   accounts to the bond. Only applied with --execute (reset requires the settlement to be already closed).
//
// Usage:
//   bun scripts/cancel-settlements.ts --keypair <operator-wallet> [--fee-payer <funded-wallet>] [--url <rpc>] [--settlements <path>] [--topup] [--reset] [--execute]
//   bun scripts/cancel-settlements.ts --keypair <operator-wallet> [--url <rpc>] [--settlements <path>] --inspect
//
// Settlements file format: { "settlements": [ { "settlement_account": "<pubkey>", "vote_account": "<pubkey>", ... }, ... ] }
// (string addresses array is also accepted)

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import {
  bondsWithdrawerAuthority,
  cancelSettlementInstruction,
  findStakeAccounts,
  getBond,
  getConfig,
  getProgram,
  resetStakeInstruction,
  settlementStakerAuthority,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  parseWallet,
  transaction,
} from '@marinade.finance/web3js-1x'
import {
  Connection,
  PublicKey,
  StakeProgram,
  SystemProgram,
} from '@solana/web3.js'
import BN from 'bn.js'

import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'

const CANCEL_SETTLEMENT_COMPUTE_UNITS = 50_000
const RESET_STAKE_COMPUTE_UNITS = 100_000

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    keypair: { type: 'string' },
    'fee-payer': { type: 'string' },
    url: { type: 'string' },
    settlements: {
      type: 'string',
      default: '/home/chalda/Downloads/977-settlement-addresses.json',
    },
    execute: { type: 'boolean', default: false },
    inspect: { type: 'boolean', default: false },
    topup: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    'compute-unit-price': { type: 'string' },
    'skip-preflight': { type: 'boolean', default: false },
  },
  allowPositionals: false,
})

if (!values.keypair) {
  process.stderr.write(
    'error: --keypair <operational-wallet> is required (operator or pause authority)\n',
  )
  process.exit(2)
}

const url = values.url ?? process.env.RPC_URL
if (!url) {
  process.stderr.write('error: --url <rpc> (or RPC_URL env) is required\n')
  process.exit(2)
}

type SettlementItem = {
  settlement: PublicKey
  vote?: PublicKey
}

function loadSettlements(path: string): {
  config?: PublicKey
  settlements: SettlementItem[]
} {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const list = Array.isArray(parsed) ? parsed : parsed.settlements
  if (!Array.isArray(list)) {
    throw new Error(
      `settlements file ${path} must be an array or have a 'settlements' array`,
    )
  }
  return {
    config: parsed.config ? new PublicKey(parsed.config) : undefined,
    settlements: list.map(item =>
      typeof item === 'string'
        ? { settlement: new PublicKey(item) }
        : {
            settlement: new PublicKey(item.settlement_account),
            vote: item.vote_account
              ? new PublicKey(item.vote_account)
              : undefined,
          },
    ),
  }
}

async function voteAccountOf(
  program: ValidatorBondsProgram,
  item: SettlementItem,
  bond: PublicKey,
): Promise<PublicKey> {
  if (item.vote) {
    return item.vote
  }
  return (await getBond(program, bond)).voteAccount
}

// lamports withdrawable from a delegated stake account = balance - rentExempt - delegated stake
function freeLamports(
  balance: BN | null,
  staked: BN | null,
  rentExempt: number,
): BN {
  return (balance ?? new BN(0)).sub(new BN(rentExempt)).sub(staked ?? new BN(0))
}

async function inspect(
  program: ValidatorBondsProgram,
  connection: Connection,
  config: PublicKey,
  settlements: SettlementItem[],
): Promise<void> {
  const [bondsAuth] = bondsWithdrawerAuthority(config, program.programId)
  const rentExempt = await connection.getMinimumBalanceForRentExemption(
    StakeProgram.space,
  )
  const { epoch: currentEpoch } = await connection.getEpochInfo()
  console.log(
    `INSPECT ${settlements.length} settlement(s); bondsWithdrawerAuthority=${bondsAuth.toBase58()} rentExemptStake=${rentExempt} epoch=${currentEpoch}`,
  )

  let cancelable = 0
  let needsTopup = 0
  let noSplitRent = 0
  let gone = 0

  for (const item of settlements) {
    const address = item.settlement.toBase58()
    const onChain = await program.account.settlement.fetchNullable(
      item.settlement,
    )
    if (onChain === null) {
      console.log(`GONE   ${address} (not found on-chain)`)
      gone++
      continue
    }

    const splitRentAmount = new BN(onChain.splitRentAmount.toString())
    if (onChain.splitRentCollector === null || splitRentAmount.isZero()) {
      console.log(
        `OK     ${address} no split-rent refund (collector=${onChain.splitRentCollector?.toBase58() ?? 'none'} amount=${splitRentAmount.toString()})`,
      )
      noSplitRent++
      continue
    }

    const vote = await voteAccountOf(program, item, onChain.bond)
    const [stakerAuth] = settlementStakerAuthority(
      item.settlement,
      program.programId,
    )
    const funded = await findStakeAccounts({
      connection,
      staker: stakerAuth,
      withdrawer: bondsAuth,
      voter: vote,
      currentEpoch,
    })

    const fundedInfo = funded.map(s => {
      const free = freeLamports(
        s.account.data.balanceLamports,
        s.account.data.stakedLamports,
        rentExempt,
      )
      return { stake: s.publicKey, free, data: s.account.data }
    })
    const best = fundedInfo.reduce<BN>(
      (m, f) => (f.free.gt(m) ? f.free : m),
      new BN(0),
    )

    if (fundedInfo.length > 0 && best.gte(splitRentAmount)) {
      console.log(
        `OK     ${address} splitRent=${splitRentAmount.toString()} funded=${fundedInfo.length} bestFree=${best.toString()} (cancelable)`,
      )
      cancelable++
      continue
    }

    const shortfall = splitRentAmount.sub(best)
    console.log(
      `TOPUP  ${address} splitRent=${splitRentAmount.toString()} vote=${vote.toBase58()} funded=${fundedInfo.length} bestFree=${best.toString()} shortfall=${shortfall.toString()}`,
    )
    for (const f of fundedInfo) {
      console.log(
        `         funded stake ${f.stake.toBase58()} bal=${f.data.balanceLamports?.toString()} staked=${f.data.stakedLamports?.toString()} free=${f.free.toString()} coolingDown=${f.data.isCoolingDown}`,
      )
    }

    const candidates = await findStakeAccounts({
      connection,
      withdrawer: bondsAuth,
      voter: vote,
      currentEpoch,
    })
    const usable = candidates
      .map(s => ({
        stake: s.publicKey,
        free: freeLamports(
          s.account.data.balanceLamports,
          s.account.data.stakedLamports,
          rentExempt,
        ),
      }))
      .filter(c => c.free.gte(splitRentAmount))
    if (usable.length > 0) {
      console.log(
        '         reusable refund candidates (voter+bondsAuth, free>=splitRent): ' +
          usable
            .map(c => `${c.stake.toBase58()}(free=${c.free.toString()})`)
            .join(', '),
      )
    } else {
      console.log(
        '         no reusable refund candidate found -> top up the funded stake account by `shortfall` lamports',
      )
    }
    needsTopup++
  }

  console.log(
    `\nDone (inspect). total=${settlements.length} cancelable=${cancelable} needsTopup=${needsTopup} noSplitRent=${noSplitRent} gone=${gone}`,
  )
}

type FundedStake = { stake: PublicKey; free: BN }
type TopupPlan = {
  refundStakeAccount: PublicKey
  shortfall: BN
}

// Stake accounts funded to the settlement (staker == settlement staker authority).
async function findFundedStakes(
  program: ValidatorBondsProgram,
  connection: Connection,
  bondsAuth: PublicKey,
  rentExempt: number,
  currentEpoch: number,
  settlement: PublicKey,
  vote: PublicKey,
): Promise<FundedStake[]> {
  const [stakerAuth] = settlementStakerAuthority(settlement, program.programId)
  const funded = await findStakeAccounts({
    connection,
    staker: stakerAuth,
    withdrawer: bondsAuth,
    voter: vote,
    currentEpoch,
  })
  return funded.map(s => ({
    stake: s.publicKey,
    free: freeLamports(
      s.account.data.balanceLamports,
      s.account.data.stakedLamports,
      rentExempt,
    ),
  }))
}

// Pick the refund stake account and the lamports it is short of `splitRentAmount`.
// Returns null when no split-rent refund is needed.
function planTopup(
  funded: FundedStake[],
  splitRentAmount: BN,
  splitRentCollector: PublicKey | null,
): TopupPlan | null {
  if (splitRentCollector === null || splitRentAmount.isZero()) {
    return null
  }
  if (funded.length === 0) {
    throw new Error(
      `split-rent refund needed (${splitRentAmount.toString()}) but no funded stake account found`,
    )
  }
  const best = funded.reduce((a, b) => (b.free.gt(a.free) ? b : a))
  const shortfall = splitRentAmount.sub(best.free)
  return {
    refundStakeAccount: best.stake,
    shortfall: shortfall.isNeg() ? new BN(0) : shortfall,
  }
}

// Reset each dangling funded stake account of a (closed) settlement back to the bond.
// Sends one tx per stake account; throws on the first failure (caller records it).
async function resetFunded(
  program: ValidatorBondsProgram,
  connection: Connection,
  feePayerWallet: Awaited<ReturnType<typeof parseWallet>>,
  config: PublicKey,
  vote: PublicKey,
  settlement: PublicKey,
  funded: FundedStake[],
  computeUnitPrice: number | undefined,
  skipPreflight: boolean,
): Promise<number> {
  let n = 0
  for (const f of funded) {
    const { instruction } = await resetStakeInstruction({
      program,
      stakeAccount: f.stake,
      settlementAccount: settlement,
      configAccount: config,
      voteAccount: vote,
    })
    const tx = await transaction(connection, feePayerWallet.publicKey)
    tx.add(instruction)
    await executeTx({
      connection,
      transaction: tx,
      signers: [feePayerWallet],
      errMessage: `Failed to reset stake ${f.stake.toBase58()} of settlement ${settlement.toBase58()}`,
      simulate: false,
      computeUnitLimit: RESET_STAKE_COMPUTE_UNITS,
      computeUnitPrice,
      sendOpts: { skipPreflight },
    })
    console.log(
      `RESET  ${f.stake.toBase58()} (settlement ${settlement.toBase58()})`,
    )
    n++
  }
  return n
}

async function main() {
  const { config, settlements } = loadSettlements(values.settlements!)
  const connection = new Connection(url!, 'confirmed')
  const wallet = await parseWallet(values.keypair!, console)
  const program = getProgram({ connection, wallet })
  const computeUnitPrice = values['compute-unit-price']
    ? Number(values['compute-unit-price'])
    : undefined

  if (values.inspect) {
    if (!config) {
      throw new Error(
        'inspect requires a "config" field in the settlements file',
      )
    }
    await inspect(program, connection, config, settlements)
    return
  }

  const authority = wallet.publicKey
  const feePayerWallet = values['fee-payer']
    ? await parseWallet(values['fee-payer'], console)
    : wallet
  const feePayer = feePayerWallet.publicKey

  const balance = await connection.getBalance(feePayer)
  console.log(
    `${values.execute ? 'EXECUTING' : 'DRY-RUN (simulate)'} cancel of ${settlements.length} settlement(s) ` +
      `with authority ${authority.toBase58()}, fee-payer ${feePayer.toBase58()} (balance ${balance} lamports) on ${url}`,
  )
  if (balance === 0) {
    throw new Error(
      `fee-payer ${feePayer.toBase58()} does not exist or has 0 lamports on ${url}. ` +
        'Simulation requires it to exist on-chain (this is the "AccountNotFound" cause). ' +
        'Pass a funded --fee-payer and the correct cluster RPC.',
    )
  }
  if (config) {
    const configData = await getConfig(program, config)
    const isAuthority =
      configData.operatorAuthority.equals(authority) ||
      configData.pauseAuthority.equals(authority)
    if (!isAuthority) {
      throw new Error(
        `wallet ${authority.toBase58()} is neither operatorAuthority ` +
          `(${configData.operatorAuthority.toBase58()}) nor pauseAuthority ` +
          `(${configData.pauseAuthority.toBase58()}) of config ${config.toBase58()}; cancel will be rejected`,
      )
    }
  }

  if (values.reset && !values.execute) {
    console.log(
      'NOTE: --reset is only applied in --execute mode (reset requires the settlement to be already closed; it cannot be simulated before cancel runs)',
    )
  }

  let bondsAuth: PublicKey | undefined
  let rentExempt = 0
  let currentEpoch = 0
  const needsStakeCtx = values.topup || (values.reset && values.execute)
  if (needsStakeCtx) {
    if (!config) {
      throw new Error(
        '--topup/--reset require a "config" field in the settlements file',
      )
    }
    ;[bondsAuth] = bondsWithdrawerAuthority(config, program.programId)
    rentExempt = await connection.getMinimumBalanceForRentExemption(
      StakeProgram.space,
    )
    ;({ epoch: currentEpoch } = await connection.getEpochInfo())
  }

  let cancelled = 0
  let skipped = 0
  let toppedUp = 0
  let resetStakes = 0
  const failures: { address: string; reason: string }[] = []

  for (const item of settlements) {
    const settlement = item.settlement
    const address = settlement.toBase58()
    try {
      const onChain = await program.account.settlement.fetchNullable(settlement)
      if (onChain === null) {
        // Already closed. If reset is requested, still reset any dangling funded stakes
        // (e.g. from a prior run that cancelled but failed to reset).
        if (values.reset && values.execute && config && item.vote) {
          const funded = await findFundedStakes(
            program,
            connection,
            bondsAuth!,
            rentExempt,
            currentEpoch,
            settlement,
            item.vote,
          )
          if (funded.length === 0) {
            console.log(`SKIP   ${address} (closed, no dangling stakes)`)
            skipped++
            continue
          }
          resetStakes += await resetFunded(
            program,
            connection,
            feePayerWallet,
            config,
            item.vote,
            settlement,
            funded,
            computeUnitPrice,
            values['skip-preflight'],
          )
          console.log(`CLOSED ${address} (reset dangling stakes)`)
          continue
        }
        console.log(`SKIP   ${address} (not found on-chain, already gone)`)
        skipped++
        continue
      }

      let funded: FundedStake[] = []
      let vote: PublicKey | undefined
      if (needsStakeCtx) {
        vote = await voteAccountOf(program, item, onChain.bond)
        funded = await findFundedStakes(
          program,
          connection,
          bondsAuth!,
          rentExempt,
          currentEpoch,
          settlement,
          vote,
        )
      }

      const plan = values.topup
        ? planTopup(
            funded,
            new BN(onChain.splitRentAmount.toString()),
            onChain.splitRentCollector,
          )
        : null

      const { instruction } = await cancelSettlementInstruction({
        program,
        settlementAccount: settlement,
        authority,
        splitRentRefundAccount: plan?.refundStakeAccount,
      })

      const tx = await transaction(connection, feePayer)
      if (plan && plan.shortfall.gtn(0)) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: feePayer,
            toPubkey: plan.refundStakeAccount,
            lamports: BigInt(plan.shortfall.toString()),
          }),
        )
      }
      tx.add(instruction)

      const signers =
        feePayerWallet === wallet ? [wallet] : [feePayerWallet, wallet]
      await executeTx({
        connection,
        transaction: tx,
        signers,
        errMessage: `Failed to cancel settlement ${address}`,
        simulate: !values.execute,
        computeUnitLimit: CANCEL_SETTLEMENT_COMPUTE_UNITS,
        computeUnitPrice,
        sendOpts: { skipPreflight: values['skip-preflight'] },
      })

      const topupNote =
        plan && plan.shortfall.gtn(0)
          ? ` (+topup ${plan.shortfall.toString()} -> ${plan.refundStakeAccount.toBase58()})`
          : ''
      if (topupNote) {
        toppedUp++
      }
      console.log(
        `${values.execute ? 'CANCEL' : 'OK-SIM'} ${address}${topupNote}`,
      )
      cancelled++

      // Reset the now-dangling funded stake accounts back to the bond.
      // Reset requires the settlement to be closed, so it only runs after cancel actually executed.
      if (values.reset && values.execute && vote) {
        resetStakes += await resetFunded(
          program,
          connection,
          feePayerWallet,
          config!,
          vote,
          settlement,
          funded,
          computeUnitPrice,
          values['skip-preflight'],
        )
      }
    } catch (err) {
      const e = err as Error & { cause?: Error; logs?: string[] }
      const reason = [
        e.message,
        e.cause ? `cause: ${e.cause.message}` : undefined,
        e.logs?.length ? `logs: ${e.logs.join(' | ')}` : undefined,
      ]
        .filter(Boolean)
        .join(' :: ')
      console.log(`FAIL   ${address}: ${reason}`)
      failures.push({ address, reason })
    }
  }

  const verb = values.execute ? 'cancelled' : 'simulated-ok'
  console.log(
    `\nDone. total=${settlements.length} ${verb}=${cancelled} toppedUp=${toppedUp} resetStakes=${resetStakes} skipped=${skipped} failed=${failures.length}`,
  )
  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`)
    for (const f of failures) {
      console.log(`  ${f.address}: ${f.reason}`)
    }
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
