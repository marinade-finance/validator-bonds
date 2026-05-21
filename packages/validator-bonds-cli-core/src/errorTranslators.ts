import { CliCommandError } from '@marinade.finance/cli-common'
import { ExecutionError, pubkey } from '@marinade.finance/web3js-1x'
import { SolanaJSONRPCError } from '@solana/web3.js'

import type { Provider } from '@coral-xyz/anchor'
import type { ExecuteTxParams } from '@marinade.finance/web3js-1x'
import type { Connection, PublicKey } from '@solana/web3.js'

export type TranslateCtx = {
  rpcEndpoint?: string
  txArgs?: ExecuteTxParams
}

type Translator = (
  err: unknown,
  ctx: TranslateCtx,
) => CliCommandError | undefined

export function buildRpcRemediationMsg(prefix: string): string {
  const envState = process.env.RPC_URL !== undefined ? 'set' : 'not set'
  return (
    `${prefix}\n  Pass a valid RPC URL with \`-u <url>\` ` +
    '(e.g. `-u mainnet`, `-u devnet`, or `-u <https-url>`).\n' +
    `  RPC_URL env var is ${envState}.`
  )
}

export function resolveRpcEndpoint(
  conn: Connection | Provider,
): string | undefined {
  if ('rpcEndpoint' in conn) return conn.rpcEndpoint
  return conn.connection?.rpcEndpoint
}

function resolveFeePayer(args: ExecuteTxParams): PublicKey | undefined {
  if (args.feePayer) {
    return args.feePayer
  }
  const firstSigner = args.signers?.[0]
  if (firstSigner) {
    try {
      return pubkey(firstSigner)
    } catch {
      return undefined
    }
  }
  return undefined
}

function getRpcErrorCode(err: unknown): number | undefined {
  if (err instanceof SolanaJSONRPCError && typeof err.code === 'number') {
    return err.code
  }
  return undefined
}

function getCauseChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = err
  const seen = new Set<unknown>()
  while (current && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

function findInCauseChain(
  err: unknown,
  predicate: (e: unknown) => boolean,
): unknown {
  return getCauseChain(err).find(predicate)
}

// Exported solely for unit tests (`__tests__/translators.spec.ts`). Not part of
// the cli-core public API; treat as internal.
export const translateRpcConnectivityError: Translator = (err, ctx) => {
  const endpoint = ctx.rpcEndpoint ?? 'the configured RPC endpoint'

  const code = getRpcErrorCode(err)
  const message = err instanceof Error ? err.message : ''
  if (code === -32601 || /method not found/i.test(message)) {
    return new CliCommandError({
      valueName: '--url',
      value: endpoint,
      msg: buildRpcRemediationMsg(
        `Endpoint at ${endpoint} is not a Solana RPC ` +
          `(JSON-RPC method is not implemented; original error: ${message}).`,
      ),
      cause: err as Error,
    })
  }

  const networkErr = findInCauseChain(err, e => {
    const c = (e as { code?: unknown }).code
    return (
      typeof c === 'string' &&
      ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(c)
    )
  }) as { code?: string; message?: string } | undefined

  if (networkErr) {
    const reason = (() => {
      switch (networkErr.code) {
        case 'ECONNREFUSED':
          return `Nothing listening at ${endpoint}`
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
          return `Cannot resolve host of ${endpoint}`
        case 'ETIMEDOUT':
          return `RPC at ${endpoint} did not respond (timeout)`
        default:
          return `Cannot reach RPC at ${endpoint}`
      }
    })()
    return new CliCommandError({
      valueName: '--url',
      value: endpoint,
      msg: buildRpcRemediationMsg(
        `${reason} (network error: ${networkErr.code}).`,
      ),
      cause: err as Error,
    })
  }

  if (/fetch failed|failed to fetch/i.test(message)) {
    return new CliCommandError({
      valueName: '--url',
      value: endpoint,
      msg: buildRpcRemediationMsg(
        `Cannot reach RPC at ${endpoint} (original error: ${message}).`,
      ),
      cause: err as Error,
    })
  }

  return undefined
}

// Exported solely for unit tests. Treat as internal.
export const translateRpcRateLimitError: Translator = (err, ctx) => {
  const endpoint = ctx.rpcEndpoint ?? 'the configured RPC endpoint'
  const code = getRpcErrorCode(err)
  const message = err instanceof Error ? err.message : ''
  if (code === -32005 || code === -32429 || /429/.test(message)) {
    return new CliCommandError({
      valueName: '--url',
      value: endpoint,
      msg: buildRpcRemediationMsg(
        `Solana RPC at ${endpoint} is rate-limited or unhealthy ` +
          `(original error: ${message}). Consider switching to a private endpoint.`,
      ),
      cause: err as Error,
    })
  }
  return undefined
}

const translateFeePayerMissingError: Translator = (err, ctx) => {
  if (!ctx.txArgs || !(err instanceof ExecutionError)) return undefined
  const fullMessage = err.messageWithCause()
  const logs = err.logs ?? []
  const allText = [fullMessage, ...logs].join('\n')
  if (
    !allText.includes(
      'Attempt to debit an account but found no record of a prior credit',
    )
  ) {
    return undefined
  }
  const feePayerAddress = resolveFeePayer(ctx.txArgs)
  return new CliCommandError({
    valueName: 'fee-payer',
    value: feePayerAddress?.toBase58() ?? 'unknown',
    msg:
      'The fee payer account does not exist on-chain.' +
      ' Make sure the fee payer account is funded with SOL before executing the transaction.',
    cause: err,
  })
}

const translateInsufficientLamportsError: Translator = (err, ctx) => {
  if (!ctx.txArgs || !(err instanceof ExecutionError)) return undefined
  const fullMessage = err.messageWithCause()
  const logs = err.logs ?? []
  const allText = [fullMessage, ...logs].join('\n')
  const insufficientMatch = allText.match(
    /insufficient lamports (\d+), need (\d+)/,
  )
  if (!insufficientMatch) return undefined
  const feePayerAddress = resolveFeePayer(ctx.txArgs)
  const feePayerInfo = feePayerAddress?.toBase58() ?? 'unknown'
  return new CliCommandError({
    valueName: 'fee-payer/rent-payer',
    value: `${feePayerInfo}, balance: ${insufficientMatch[1]} lamports, needed: ${insufficientMatch[2]} lamports`,
    msg:
      'The fee payer or rent payer account does not have enough SOL to cover the transaction fees and rent.' +
      ' Make sure the account is funded before executing the transaction.',
    cause: err,
  })
}

const KNOWN_ERROR_TRANSLATORS: Translator[] = [
  translateRpcConnectivityError,
  translateRpcRateLimitError,
  translateFeePayerMissingError,
  translateInsufficientLamportsError,
]

export function translateKnownError(err: unknown, ctx: TranslateCtx): never {
  for (const translator of KNOWN_ERROR_TRANSLATORS) {
    const translated = translator(err, ctx)
    if (translated) throw translated
  }
  throw err
}
