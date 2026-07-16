import {
  DEFAULT_CONFIG,
  augmentAuctionResult,
  getValidatorTip,
  selectRedelegationPriorityFrontierPmpe,
} from '@marinade.finance/ds-sam-calc'
import {
  MARINADE_CONFIG_ADDRESS,
  bondAddress,
  findBondNonSettlementStakeAccounts,
  findWithdrawRequests,
} from '@marinade.finance/validator-bonds-sdk'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { raceWithTimeout } from './async'
import { Color, getBanner } from './banner'
import { getCliContext } from './context'

import type {
  AuctionResult,
  AuctionValidator,
  DsSamConfig,
  TipUrgency,
} from '@marinade.finance/ds-sam-calc'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { EpochInfo, PublicKey } from '@solana/web3.js'

interface BannerLogger {
  debug: (msg: string) => void
}

const BOND_TIP_FETCH_TIMEOUT_MS = 3000
const FRESH_BALANCE_TIMEOUT_MS = 3000

// Auction context relayed by the bonds API from the bonds-eventing auction run.
// meta scalars are auction-wide singletons; validators are the calc-relevant
// AuctionValidator subset keyed by vote account. See bonds-eventing calc-relay.ts.
export interface AuctionMetaResponse {
  epoch: number
  winningTotalPmpe: number
  marinadeSamTvlSol: number
  minBondEpochs: number
  idealBondEpochs: number
  minBondBalanceSol: number
  bondRiskFeeMult: number
  bidTooLowPenaltyHistoryEpochs: number
  bidTooLowPenaltyPermittedDeviationPmpe: number
  minMaxStakeWanted: number | null
  blacklist: string[]
}

export interface AuctionContextResponse {
  auction_meta: AuctionMetaResponse | null
  auction_validators: Record<string, Record<string, unknown>>
}

function urgencyColor(urgency: TipUrgency): Color | undefined {
  switch (urgency) {
    case 'critical':
      return Color.Red
    case 'warning':
      return Color.Yellow
    case 'positive':
      return Color.Green
    default:
      return undefined
  }
}

async function fetchAuctionContext(
  apiUrl: string,
  logger?: BannerLogger,
): Promise<AuctionContextResponse | null> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    BOND_TIP_FETCH_TIMEOUT_MS,
  )
  timeout.unref?.()
  try {
    const url = `${apiUrl.replace(/\/$/, '')}/bonds/bidding/auction`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      logger?.debug(`Bonds API ${url} returned HTTP ${response.status}`)
      return null
    }
    return (await response.json()) as AuctionContextResponse
  } catch (error) {
    logger?.debug(
      `Failed to fetch auction context: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Real-time bond balance (SOL) from a TARGETED getProgramAccounts (filtered by
// vote account + bonds withdrawer authority), so a just-run fund-bond is
// reflected. Settlement stake is excluded. A pending withdraw request earmarks
// funded stake that is not moved on-chain until claim, so it is subtracted from
// the claimable figure (but not from the owned balance). Bounded by a timeout
// and returns null only on slow/refused RPC (the caller then falls back to the
// auction snapshot); an empty result is a genuine zero balance, not a miss.
async function fetchFreshBondBalanceSol(
  program: ValidatorBondsProgram,
  voteAccount: PublicKey,
  currentEpoch: number | undefined,
  logger?: BannerLogger,
): Promise<{ bondBalanceSol: number; claimableBondBalanceSol: number } | null> {
  const balance = (async () => {
    try {
      const stakeAccounts = await findBondNonSettlementStakeAccounts({
        program,
        configAccount: MARINADE_CONFIG_ADDRESS,
        voteAccount,
        currentEpoch,
      })
      const ownedLamports = stakeAccounts.reduce(
        (sum, s) => sum + s.account.lamports,
        0,
      )
      const [bond] = bondAddress(
        MARINADE_CONFIG_ADDRESS,
        voteAccount,
        program.programId,
      )
      const [withdrawRequest] = await findWithdrawRequests({ program, bond })
      const pendingLamports = withdrawRequest
        ? withdrawRequest.account.requestedAmount
            .sub(withdrawRequest.account.withdrawnAmount)
            .toNumber()
        : 0
      return {
        bondBalanceSol: ownedLamports / LAMPORTS_PER_SOL,
        claimableBondBalanceSol:
          Math.max(0, ownedLamports - pendingLamports) / LAMPORTS_PER_SOL,
      }
    } catch (error) {
      logger?.debug(
        `Failed to fetch fresh bond balance: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  })()
  return raceWithTimeout(balance, FRESH_BALANCE_TIMEOUT_MS, null)
}

// Rebuild the AuctionResult the calc lib expects from the relayed blobs. The
// per-validator blobs already carry exactly the fields getValidatorTip reads;
// unused AuctionData fields (rewards, network totals) are filled with neutral
// values calc's tip path never touches.
export function reconstructAuctionResult(
  context: AuctionContextResponse,
  meta: AuctionMetaResponse,
): AuctionResult {
  const validators = Object.values(
    context.auction_validators,
  ) as unknown as AuctionValidator[]
  return {
    auctionData: {
      epoch: meta.epoch,
      validators,
      rewards: { inflationPmpe: 0, mevPmpe: 0 },
      stakeAmounts: {
        networkTotalSol: 0,
        marinadeSamTvlSol: meta.marinadeSamTvlSol,
        marinadeRemainingSamSol: 0,
      },
      blacklist: new Set(meta.blacklist),
    },
    winningTotalPmpe: meta.winningTotalPmpe,
  } as unknown as AuctionResult
}

export function metaToConfig(meta: AuctionMetaResponse): DsSamConfig {
  return {
    ...DEFAULT_CONFIG,
    minBondEpochs: meta.minBondEpochs,
    idealBondEpochs: meta.idealBondEpochs,
    minBondBalanceSol: meta.minBondBalanceSol,
    bondRiskFeeMult: meta.bondRiskFeeMult,
    bidTooLowPenaltyHistoryEpochs: meta.bidTooLowPenaltyHistoryEpochs,
    bidTooLowPenaltyPermittedDeviationPmpe:
      meta.bidTooLowPenaltyPermittedDeviationPmpe,
    minMaxStakeWanted: meta.minMaxStakeWanted,
  }
}

/**
 * Best-effort: fetch the auction context, run ds-sam-calc for the given vote
 * account and print the validator's next-step tip to stderr. Never throws and
 * never blocks the command result — failures are silently debug-logged. Renders
 * the same tip the PSR dashboard shows for the validator.
 *
 * @param bondBalanceSol optional fresh on-chain owned balance used instead of
 *   the auction snapshot's value.
 * @param claimableBondBalanceSol optional fresh claimable balance (owned minus
 *   any pending withdraw request) used instead of the auction snapshot's value.
 */
export async function maybePrintBondTipBanner({
  apiUrl,
  enabled,
  voteAccount,
  currentEpoch,
  bondBalanceSol,
  claimableBondBalanceSol,
  logger,
}: {
  apiUrl: string
  enabled: boolean
  voteAccount: PublicKey | undefined
  currentEpoch?: number
  bondBalanceSol?: number
  claimableBondBalanceSol?: number
  logger?: BannerLogger
}): Promise<void> {
  if (!enabled || voteAccount === undefined) return
  try {
    const context = await fetchAuctionContext(apiUrl, logger)
    // auction_meta is omitted (not null) on the wire when absent, so a truthy
    // check is required here, not `=== null`.
    if (!context || !context.auction_meta) return

    const meta = context.auction_meta
    const voteAccountStr = voteAccount.toBase58()
    const blob = context.auction_validators[voteAccountStr]
    if (blob === undefined) return

    // maxStakeWanted is deliberately not overridden: the auction's target/cap
    // fields cannot be recomputed client-side, so a fresh value would mix with a
    // stale target and yield an incoherent tip. It takes effect next auction.
    if (bondBalanceSol !== undefined) {
      blob.bondBalanceSol = bondBalanceSol
    }
    if (claimableBondBalanceSol !== undefined) {
      blob.claimableBondBalanceSol = claimableBondBalanceSol
    }

    const result = reconstructAuctionResult(context, meta)
    const config = metaToConfig(meta)
    const augmented = augmentAuctionResult(result, config.minBondBalanceSol)
    const me = augmented.find(v => v.voteAccount === voteAccountStr)
    if (me === undefined) return

    const priorityFrontierPmpe = selectRedelegationPriorityFrontierPmpe(
      result,
      config.minBondBalanceSol,
    )
    const tip = getValidatorTip(
      me,
      config,
      meta.winningTotalPmpe,
      undefined,
      result.auctionData.blacklist,
      priorityFrontierPmpe,
    )

    // Auction runs once per epoch, so being one epoch behind is normal; flag
    // only when it lags further (pipeline stalled) so the figures read honestly.
    const stale =
      currentEpoch !== undefined && currentEpoch - meta.epoch >= 2
        ? `Auction data is from epoch ${meta.epoch} (current epoch ${currentEpoch}) — figures may be outdated.\n\n`
        : ''

    const banner = getBanner({
      title: 'Marinade Stake Auction · Bond Guidance',
      text: `${stale}${tip.text}`,
      centerText: false,
      textColor: urgencyColor(tip.urgency),
    })
    console.error(`\n${banner}\n`)
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
export async function printBondTipBannerFromContext(params: {
  voteAccount: PublicKey | undefined
}): Promise<void> {
  // Interactive use only: never add box noise to piped/CI stderr capture.
  if (!process.stderr.isTTY) return

  let ctx: ReturnType<typeof getCliContext>
  try {
    ctx = getCliContext()
  } catch {
    return
  }
  if (ctx.simulate || ctx.printOnly) return
  if (!ctx.bondsApiEnabled) return

  const epochInfo = await raceWithTimeout<EpochInfo | undefined>(
    ctx.provider.connection.getEpochInfo(),
    FRESH_BALANCE_TIMEOUT_MS,
    undefined,
  )
  const currentEpoch = epochInfo?.epoch

  let fresh: Awaited<ReturnType<typeof fetchFreshBondBalanceSol>> = null
  if (params.voteAccount !== undefined) {
    fresh = await fetchFreshBondBalanceSol(
      ctx.program,
      params.voteAccount,
      currentEpoch,
      ctx.logger,
    )
  }

  await maybePrintBondTipBanner({
    apiUrl: ctx.bondsApiUrl,
    enabled: ctx.bondsApiEnabled,
    voteAccount: params.voteAccount,
    currentEpoch,
    bondBalanceSol: fresh?.bondBalanceSol,
    claimableBondBalanceSol: fresh?.claimableBondBalanceSol,
    logger: ctx.logger,
  })
}
