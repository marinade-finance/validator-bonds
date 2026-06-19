import { Color, getBanner } from './banner'
import { getCliContext } from './context'

import type { PublicKey } from '@solana/web3.js'

// Minimal logger surface so callers can pass a pino Logger or the CLI context
// logger placeholder interchangeably.
interface BannerLogger {
  debug: (msg: string) => void
}

const BOND_TIP_BANNER_TIMEOUT_MS = 1500

// Subset of the validator-bonds API `/bonds/bidding` record we rely on. The
// bond advice (`bond_tip` + `bond_tip_urgency`) is computed server-side by the
// eventing pipeline's CTA engine; the CLI only renders it.
interface BiddingBondApiRecord {
  vote_account: string
  bond_tip: string | null
  bond_tip_urgency: string | null
}

// Maps the CTA engine urgency to a banner colour. Mirrors the dashboard's
// tone mapping (critical=red, warning=yellow, info=cyan, positive=green).
function colorForUrgency(urgency: string | null): Color | undefined {
  switch (urgency) {
    case 'critical':
      return Color.Red
    case 'warning':
      return Color.Yellow
    case 'info':
      return Color.Cyan
    case 'positive':
      return Color.Green
    default:
      return Color.Bold
  }
}

/**
 * Renders the bond/cap advice tip as a banner, or null when there is no tip.
 */
export function buildBondTipBanner({
  tipText,
  urgency,
}: {
  tipText: string | null
  urgency: string | null
}): string | null {
  if (!tipText) return null
  return getBanner({
    title: 'Marinade Stake Auction',
    text: tipText,
    centerText: false,
    textColor: colorForUrgency(urgency),
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
    BOND_TIP_BANNER_TIMEOUT_MS,
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
 * Best-effort: fetch the validator's bidding bond from the API and, if it has
 * bond/cap advice, print it as a banner to stderr. Never throws and never
 * blocks the command result — failures are silently debug-logged.
 */
export async function maybePrintBondTip({
  apiUrl,
  enabled,
  voteAccount,
  logger,
}: {
  apiUrl: string
  enabled: boolean
  voteAccount: PublicKey | undefined
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

    const banner = buildBondTipBanner({
      tipText: record.bond_tip,
      urgency: record.bond_tip_urgency,
    })
    if (banner !== null) {
      console.error(`\n${banner}\n`)
    }
  } catch (error) {
    logger?.debug(
      `Failed to print bond tip banner: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Convenience wrapper that pulls the API config + logger from the CLI context.
 * Call after a command succeeds. Skips dry runs (simulate / print-only) since
 * nothing changed on chain, and is a no-op when the context is unavailable.
 */
export async function printBondTipFromContext(params: {
  voteAccount: PublicKey | undefined
}): Promise<void> {
  let ctx: ReturnType<typeof getCliContext>
  try {
    ctx = getCliContext()
  } catch {
    return
  }
  if (ctx.simulate || ctx.printOnly) return
  await maybePrintBondTip({
    apiUrl: ctx.bondsApiUrl,
    enabled: ctx.bondsApiEnabled,
    voteAccount: params.voteAccount,
    logger: ctx.logger,
  })
}
