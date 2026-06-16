import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { Color, getBanner } from './banner'
import { getCliContext } from './context'

import type { PublicKey } from '@solana/web3.js'

// Minimal logger surface so callers can pass a pino Logger or the CLI context
// logger placeholder interchangeably.
interface BannerLogger {
  debug: (msg: string) => void
}

const STAKE_CAP_BANNER_TIMEOUT_MS = 1500

// Subset of the validator-bonds API `/bonds/bidding` record we rely on. All
// amounts are in lamports (matching `funded_amount` / `max_stake_wanted`). The
// SAM enrichment fields are populated from `bond_event_state`, so they are
// nullable when the auction pipeline has no snapshot for the validator.
interface BiddingBondApiRecord {
  vote_account: string
  max_stake_wanted: number | string
  funded_amount: number | string
  effective_amount: number | string
  auction_stake: number | string | null
  cap_constraint: string | null
  required_balance: number | string | null
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : null
}

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Builds the "bond is capping your stake" banner, or returns null when it does
 * not apply. Shown only when the validator wants more stake than Marinade
 * currently targets AND the binding auction cap is the bond balance (so adding
 * bond actually unlocks stake). All inputs are lamports.
 */
export function buildBondCapBanner({
  maxStakeWantedLamports,
  targetStakeLamports,
  bondBalanceLamports,
  requiredBalanceLamports,
  capConstraint,
}: {
  maxStakeWantedLamports: number
  targetStakeLamports: number
  bondBalanceLamports: number
  requiredBalanceLamports: number | null
  capConstraint: string | null
}): string | null {
  // Only nudge when the bond is the binding constraint; for COUNTRY / ASO /
  // VALIDATOR / WANT / RISK caps, adding bond would not raise the target.
  if (capConstraint !== 'BOND') return null
  // Need a meaningful target to derive the bond -> stake leverage from.
  if (targetStakeLamports <= 0 || bondBalanceLamports <= 0) return null
  // Only when they actually want more than they currently get.
  if (maxStakeWantedLamports <= targetStakeLamports) return null

  // At the binding bond cap the target scales linearly with the bond balance,
  // so the empirical leverage is target / balance (stake SOL per bond SOL).
  const leverage = targetStakeLamports / bondBalanceLamports
  const extraStakeLamports = maxStakeWantedLamports - targetStakeLamports
  const extraBondLamports = extraStakeLamports / leverage

  // Min balance to keep the currently delegated stake; below it the bond can no
  // longer cover the stake's obligations and stake is at risk of undelegation.
  // Fall back to the current balance when the pipeline has not reported it.
  const minBalanceLamports = requiredBalanceLamports ?? bondBalanceLamports

  const text =
    'Your bond balance is capping your stake.\n' +
    '\n' +
    `maxStakeWanted:           ${formatSol(maxStakeWantedLamports)} SOL\n` +
    `Current Marinade target:  ${formatSol(targetStakeLamports)} SOL  (limited by bond)\n` +
    '\n' +
    `Increase your bond by at least ${formatSol(extraBondLamports)} SOL to unlock up to\n` +
    `+${formatSol(extraStakeLamports)} SOL of additional delegated stake.\n` +
    '\n' +
    `Keep your bond balance at >= ${formatSol(minBalanceLamports)} SOL — below this your\n` +
    'stake is at risk of being undelegated.'

  return getBanner({
    title: 'Marinade Stake Auction · Bond Cap',
    text,
    centerText: false,
    textColor: Color.Yellow,
  })
}

async function fetchBiddingBondRecord(
  apiUrl: string,
  voteAccount: string,
  logger?: BannerLogger,
): Promise<BiddingBondApiRecord | null> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    STAKE_CAP_BANNER_TIMEOUT_MS,
  )
  timeout.unref?.()
  try {
    const url = `${apiUrl.replace(/\/$/, '')}/bonds/bidding`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      logger?.debug(`Bonds API ${url} returned HTTP ${response.status}`)
      return null
    }
    const body = (await response.json()) as { bonds?: BiddingBondApiRecord[] }
    const record = body.bonds?.find(b => b.vote_account === voteAccount)
    return record ?? null
  } catch (error) {
    logger?.debug(
      `Failed to fetch bidding bonds: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Best-effort: fetch the validator's bidding bond from the API and, if the bond
 * is capping its stake, print the banner to stderr. Never throws and never
 * blocks the command result — failures are silently debug-logged.
 *
 * @param maxStakeWantedLamports optional override (e.g. the value a just-issued
 *   configure-bond set) used instead of the API's possibly-stale value.
 */
export async function maybePrintBondCapBanner({
  apiUrl,
  enabled,
  voteAccount,
  maxStakeWantedLamports,
  logger,
}: {
  apiUrl: string
  enabled: boolean
  voteAccount: PublicKey | undefined
  maxStakeWantedLamports?: number
  logger?: BannerLogger
}): Promise<void> {
  if (!enabled || voteAccount === undefined) return
  try {
    const record = await fetchBiddingBondRecord(
      apiUrl,
      voteAccount.toBase58(),
      logger,
    )
    if (record === null) return

    const target = toNumber(record.auction_stake)
    const bondBalance = toNumber(record.effective_amount)
    const maxStakeWanted =
      maxStakeWantedLamports ?? toNumber(record.max_stake_wanted)
    if (target === null || bondBalance === null || maxStakeWanted === null) {
      return
    }

    const banner = buildBondCapBanner({
      maxStakeWantedLamports: maxStakeWanted,
      targetStakeLamports: target,
      bondBalanceLamports: bondBalance,
      requiredBalanceLamports: toNumber(record.required_balance),
      capConstraint: record.cap_constraint,
    })
    if (banner !== null) {
      console.error(`\n${banner}\n`)
    }
  } catch (error) {
    logger?.debug(
      `Failed to print bond cap banner: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Convenience wrapper that pulls the API config + logger from the CLI context.
 * Call after a command succeeds. Skips dry runs (simulate / print-only) since
 * nothing changed on chain, and is a no-op when the context is unavailable.
 */
export async function printBondCapBannerFromContext(params: {
  voteAccount: PublicKey | undefined
  maxStakeWantedLamports?: number
}): Promise<void> {
  let ctx: ReturnType<typeof getCliContext>
  try {
    ctx = getCliContext()
  } catch {
    return
  }
  if (ctx.simulate || ctx.printOnly) return
  await maybePrintBondCapBanner({
    apiUrl: ctx.bondsApiUrl,
    enabled: ctx.bondsApiEnabled,
    voteAccount: params.voteAccount,
    maxStakeWantedLamports: params.maxStakeWantedLamports,
    logger: ctx.logger,
  })
}
