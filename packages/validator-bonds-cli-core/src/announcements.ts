import { parseAndValidate } from '@marinade.finance/cli-common'
import { Expose, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

import type { Logger } from 'pino'

export const ANNOUNCEMENTS_API_URL =
  'https://validator-bonds-api.marinade.finance/v1/announcements'
export const ANNOUNCEMENTS_TIMEOUT_MS = 1500

export interface AnnouncementsConfig {
  enabled: boolean
  cliType: CliType
}

export enum CliType {
  Sam = 'sam',
  Institutional = 'institutional',
}

export class CliAnnouncementDto {
  @Expose()
  @IsInt()
  readonly id!: number

  @Expose()
  @IsString()
  readonly created_at!: string

  @Expose()
  @IsString()
  readonly updated_at!: string

  @Expose()
  @IsInt()
  readonly group_id!: number

  @Expose()
  @IsInt()
  readonly group_order!: number

  @Expose()
  @IsString()
  @IsOptional()
  readonly title?: string | null

  @Expose()
  @IsString()
  readonly text!: string

  @Expose()
  @IsBoolean()
  readonly enabled!: boolean

  @Expose()
  @IsString()
  @IsOptional()
  readonly operation_filter?: string | null

  @Expose()
  @IsString()
  @IsOptional()
  readonly account_filter?: string | null

  @Expose()
  @IsEnum(CliType)
  @IsOptional()
  readonly type_filter?: CliType | null
}

export class CliAnnouncementsResponseDto {
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CliAnnouncementDto)
  readonly announcements!: CliAnnouncementDto[]
}

export interface AnnouncementRequestParams {
  account?: string | Promise<{ toBase58: () => string } | undefined>
  operation?: string
  cliVersion?: string
  cliType?: CliType
  apiUrl?: string
}

let announcementPromise: Promise<CliAnnouncementsResponseDto | null> | null =
  null

interface ResolvedAnnouncementParams {
  account?: string
  operation?: string
  cliVersion?: string
  cliType?: CliType
  apiUrl?: string
}

function buildAnnouncementUrl(params: ResolvedAnnouncementParams): string {
  const baseUrl =
    params.apiUrl || process.env.ANNOUNCEMENTS_API_URL || ANNOUNCEMENTS_API_URL
  const url = new URL(baseUrl)
  if (params.account) {
    url.searchParams.set('account', params.account)
  }
  if (params.operation) {
    url.searchParams.set('operation', params.operation)
  }
  if (params.cliVersion) {
    url.searchParams.set('cli_version', params.cliVersion)
  }
  if (params.cliType) {
    url.searchParams.set('type', params.cliType)
  }
  return url.toString()
}

async function fetchAnnouncementsInternal(
  params: AnnouncementRequestParams,
  logger?: Logger,
): Promise<CliAnnouncementsResponseDto | null> {
  // Resolve account if it's a Promise (from async parsePubkey)
  let accountStr: string | undefined
  if (params.account) {
    try {
      const resolved = await Promise.resolve(params.account)
      accountStr =
        resolved && typeof resolved === 'object' && 'toBase58' in resolved
          ? resolved.toBase58()
          : typeof resolved === 'string'
            ? resolved
            : undefined
    } catch {
      // If account resolution fails, continue without it
      accountStr = undefined
    }
  }

  const resolvedParams: ResolvedAnnouncementParams = {
    account: accountStr,
    operation: params.operation,
    cliVersion: params.cliVersion,
    cliType: params.cliType,
    apiUrl: params.apiUrl,
  }

  try {
    const url = buildAnnouncementUrl(resolvedParams)

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      ANNOUNCEMENTS_TIMEOUT_MS,
    )

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      logger?.debug(`Announcements API returned status ${response.status}`)
      return null
    }

    const jsonText = await response.text()
    const { data } = await parseAndValidate<CliAnnouncementsResponseDto>(
      jsonText,
      CliAnnouncementsResponseDto,
    )

    logger?.debug(`Loaded ${data.announcements.length} announcements from API`)
    return data
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        logger?.debug('Announcements API request timed out')
      } else {
        logger?.debug(`Announcements API error: ${error.message}`)
      }
    }
    return null
  }
}

/**
 * Starts fetching announcements from the API.
 * This is non-blocking - call getAnnouncements() later to get the result.
 */
export function startFetchingAnnouncements(
  params: AnnouncementRequestParams,
  logger?: Logger,
): void {
  announcementPromise = fetchAnnouncementsInternal(params, logger)
}

/**
 * Gets the announcements, waiting up to the specified timeout.
 * Returns null if no announcements available or on error.
 */
export async function getAnnouncements(
  timeoutMs: number = ANNOUNCEMENTS_TIMEOUT_MS,
): Promise<CliAnnouncementsResponseDto | null> {
  if (!announcementPromise) {
    return null
  }

  try {
    const result = await Promise.race([
      announcementPromise,
      new Promise<null>(resolve => {
        setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
    return result
  } catch {
    return null
  }
}

/**
 * Clears the cached announcement promise.
 * Useful for testing or resetting state.
 */
export function clearAnnouncementCache(): void {
  announcementPromise = null
}
