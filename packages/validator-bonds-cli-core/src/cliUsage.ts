import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { ExecutionError } from '@marinade.finance/web3js-1x'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'
import type { Logger } from 'pino'

const MIXPANEL_TIMEOUT_MS = 1500

// Array#join avoids constant-folding, so the injector rewrites only BUILD_TIME_MIXPANEL_TOKEN.
const MIXPANEL_TOKEN_PLACEHOLDER = [
  '__',
  'MIXPANEL_TOKEN_PLACEHOLDER',
  '__',
].join('')
const BUILD_TIME_MIXPANEL_TOKEN: string = '__MIXPANEL_TOKEN_PLACEHOLDER__'

export const DEFAULT_MIX_PROXY_URL = 'https://mix-proxy.marinade.finance'

export type ClusterLabel =
  | 'mainnet'
  | 'devnet'
  | 'testnet'
  | 'localnet'
  | 'custom'

// Raw `-u/--url` may carry an RPC API key; only forward a coarse label.
export function clusterLabel(input: string | undefined): ClusterLabel {
  switch (input) {
    case 'm':
    case 'mainnet':
    case 'mainnet-beta':
      return 'mainnet'
    case 'd':
    case 'devnet':
      return 'devnet'
    case 't':
    case 'testnet':
      return 'testnet'
    case 'l':
    case 'localnet':
    case 'localhost':
      return 'localnet'
    default:
      return 'custom'
  }
}

export type CliType = 'sam' | 'institutional'

export interface CliUsageConfig {
  enabled: boolean
  cliType: CliType
}

export type CompletionResult =
  | 'success'
  | 'transaction_error'
  | 'network_error'
  | 'validation_error'
  | 'other'

export interface BaseEventParams {
  mixProxyUrl: string
  cliType: CliType
  cliVersion: string
  operation: string
  sessionId: string
  walletPubkey?: string
  installId: string
  cluster: ClusterLabel
  simulate: boolean
  printOnly: boolean
}

export type AccountField =
  | 'bond_account'
  | 'config_account'
  | 'settlement_account'
  | 'vote_account'
  | 'stake_account'
  | 'withdraw_request_account'
  | 'account'

export interface CliCommandEventParams extends BaseEventParams {
  account?: string
  accountField?: AccountField
}

export interface PendingCompletion extends BaseEventParams {
  startedAt: number
}

export interface ResolvedAccounts {
  bondAccount?: string
  voteAccount?: string
  configAccount?: string
  stakeAccount?: string
  withdrawRequestAccount?: string
}

export interface CliCommandCompleteEventParams
  extends BaseEventParams,
    ResolvedAccounts {
  result: CompletionResult
  durationMs: number
  signatures?: string[]
  signaturesTruncated?: boolean
  amountLamports?: string
}

const SIGNATURE_CAP = 20

type PendingTxData = {
  signatures: string[]
  signaturesTruncated: boolean
  amountLamports?: string
} & ResolvedAccounts

let pendingTxData: PendingTxData = {
  signatures: [],
  signaturesTruncated: false,
}

export function recordTxSignature(signature: string): void {
  if (pendingTxData.signatures.length >= SIGNATURE_CAP) {
    pendingTxData.signaturesTruncated = true
    return
  }
  pendingTxData.signatures.push(signature)
}

// Caller stringifies its BN/bigint to keep this module free of bn.js dependency;
// 'ALL' is the sentinel for U64_MAX-encoded full withdrawals.
export function recordAmountLamports(amountLamports: string): void {
  pendingTxData.amountLamports = amountLamports
}

export function recordResolvedAccounts(accounts: {
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  configAccount?: PublicKey
  stakeAccount?: PublicKey
  withdrawRequestAccount?: PublicKey
}): void {
  if (accounts.bondAccount)
    pendingTxData.bondAccount = accounts.bondAccount.toBase58()
  if (accounts.voteAccount)
    pendingTxData.voteAccount = accounts.voteAccount.toBase58()
  if (accounts.configAccount)
    pendingTxData.configAccount = accounts.configAccount.toBase58()
  if (accounts.stakeAccount)
    pendingTxData.stakeAccount = accounts.stakeAccount.toBase58()
  if (accounts.withdrawRequestAccount)
    pendingTxData.withdrawRequestAccount =
      accounts.withdrawRequestAccount.toBase58()
}

export function drainTxData(): PendingTxData {
  const drained = pendingTxData
  pendingTxData = { signatures: [], signaturesTruncated: false }
  return drained
}

export interface ProgramTelemetryFields {
  accountField?: AccountField
}

const TELEMETRY_FIELDS_KEY = Symbol('validatorBonds.programTelemetryFields')
type CommandWithTelemetryFields = {
  [TELEMETRY_FIELDS_KEY]?: ProgramTelemetryFields
}

export function setProgramTelemetryFields(
  cmd: Command,
  fields: ProgramTelemetryFields,
): Command {
  ;(cmd as Command & CommandWithTelemetryFields)[TELEMETRY_FIELDS_KEY] = fields
  return cmd
}

export function getProgramTelemetryFields(
  cmd: Command,
): ProgramTelemetryFields {
  return (
    (cmd as Command & CommandWithTelemetryFields)[TELEMETRY_FIELDS_KEY] ?? {}
  )
}

export function getMixpanelToken(): string | undefined {
  const override = process.env.MIXPANEL_TOKEN_TEST
  const resolved =
    override && override.length > 0 ? override : BUILD_TIME_MIXPANEL_TOKEN
  return resolved === MIXPANEL_TOKEN_PLACEHOLDER ? undefined : resolved
}

export function isTelemetryDisabled(): boolean {
  if (process.env.DO_NOT_TRACK === '1') return true
  if (getMixpanelToken() === undefined) return true
  return false
}

export function errorClass(err: unknown): CompletionResult {
  if (err instanceof ExecutionError) return 'transaction_error'
  if (err instanceof Error) {
    if (err.name === 'CommanderError') return 'validation_error'
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(err.message)) {
      return 'network_error'
    }
  }
  return 'other'
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && xdg.startsWith('/')) return xdg
  return join(homedir(), '.config')
}

let cachedInstallId: string | undefined

export function getOrCreateInstallId(logger?: Logger): string {
  if (cachedInstallId) return cachedInstallId
  const file = join(configDir(), 'validator-bonds', 'install-id')
  try {
    const existing = readFileSync(file, 'utf-8').trim()
    if (existing.length > 0) {
      cachedInstallId = existing
      return existing
    }
  } catch (err) {
    logger?.debug(
      `install-id read fallback: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const id = randomUUID()
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, id + '\n', { mode: 0o600 })
  } catch (err) {
    logger?.debug(
      `install-id write fallback (ephemeral id): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  cachedInstallId = id
  return id
}

function buildBaseProperties(params: BaseEventParams): Record<string, unknown> {
  const token = getMixpanelToken()
  const distinctId = params.walletPubkey ?? params.installId
  const props: Record<string, unknown> = {
    token,
    time: Math.floor(Date.now() / 1000),
    $insert_id: randomUUID(),
    distinct_id: distinctId,
    $device_id: params.installId,
    session_id: params.sessionId,
    cli_name: params.cliType,
    cli_version: params.cliVersion,
    operation: params.operation,
    cluster: params.cluster,
    simulate: params.simulate,
    print_only: params.printOnly,
    os: process.platform,
    arch: process.arch,
    node_version: process.version,
  }
  if (params.walletPubkey) {
    props.$user_id = params.walletPubkey
  }
  return props
}

async function postEvent(
  mixProxyUrl: string,
  event: { event: string; properties: Record<string, unknown> },
  logger?: Logger,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const url = new URL('/track', mixProxyUrl)
    url.searchParams.set('ip', '0')
    url.searchParams.set('verbose', '0')
    const controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), MIXPANEL_TIMEOUT_MS)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([event]),
      signal: controller.signal,
    })
    if (!response.ok) {
      logger?.debug(`Mixpanel /track returned status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error) {
      logger?.debug(`Mixpanel /track error: ${err.message}`)
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export async function recordCliCommand(
  params: CliCommandEventParams,
  logger?: Logger,
): Promise<void> {
  if (isTelemetryDisabled()) return
  const properties = buildBaseProperties(params)
  if (params.account) {
    properties[params.accountField ?? 'account'] = params.account
  }
  await postEvent(
    params.mixProxyUrl,
    { event: 'cli_command', properties },
    logger,
  )
}

export async function recordCliCommandComplete(
  params: CliCommandCompleteEventParams,
  logger?: Logger,
): Promise<void> {
  if (isTelemetryDisabled()) return
  const properties = buildBaseProperties(params)
  properties.result = params.result
  properties.duration_ms = params.durationMs
  if (params.signatures && params.signatures.length > 0) {
    properties.signatures = params.signatures
  }
  if (params.signaturesTruncated) {
    properties.signatures_truncated = true
  }
  if (params.amountLamports !== undefined) {
    properties.amount_lamports = params.amountLamports
  }
  if (params.bondAccount !== undefined) {
    properties.bond_account = params.bondAccount
  }
  if (params.voteAccount !== undefined) {
    properties.vote_account = params.voteAccount
  }
  if (params.configAccount !== undefined) {
    properties.config_account = params.configAccount
  }
  if (params.stakeAccount !== undefined) {
    properties.stake_account = params.stakeAccount
  }
  if (params.withdrawRequestAccount !== undefined) {
    properties.withdraw_request_account = params.withdrawRequestAccount
  }
  await postEvent(
    params.mixProxyUrl,
    { event: 'cli_command_complete', properties },
    logger,
  )
}
