import { getNotificationBanners } from './notifications'

import type { Logger } from 'pino'

const LEFT_CORNER = '╔'
const RIGHT_CORNER = '╗'
const HORIZONTAL_LINE = '═'
const VERTICAL_LINE = '║'
const BOTTOM_LEFT_CORNER = '╚'
const BOTTOM_RIGHT_CORNER = '╝'

/**
 * Prints broadcast notifications from the API as banners.
 * Waits up to timeoutMs for the API response.
 * On error or timeout, nothing is printed (silent failure).
 */
export async function printNotificationBanners(
  logger?: Logger,
  timeoutMs?: number,
  linesAround: number = 1,
): Promise<void> {
  try {
    const notifications = await getNotificationBanners(timeoutMs)

    if (!notifications || notifications.length === 0) {
      logger?.debug('No notifications to display')
      return
    }

    const banners = notifications.map(notification =>
      getBanner({
        title: notification.title ?? undefined,
        text: notification.message,
        centerText: false,
        textColor: Color.Bold,
      }),
    )
    const surrounding = '\n'.repeat(linesAround)
    console.error(`${surrounding}${banners.join('\n')}${surrounding}`)
  } catch (error) {
    logger?.debug(
      `Failed to print notification banners: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const DEFAULT_PREFERRED_WIDTH = 150
const DEFAULT_MIN_WIDTH = 80
const BOX_OVERHEAD = 4 // ║ + space + space + ║
const SIMPLE_OVERHEAD = 2 // small margin for the simple-mode horizontal line

export function getBanner({
  text,
  title,
  preferredWidth = DEFAULT_PREFERRED_WIDTH,
  minWidth = DEFAULT_MIN_WIDTH,
  centerText,
  linesAround,
  textColor,
  titleColor = textColor,
}: {
  text: string
  title?: string
  preferredWidth?: number
  minWidth?: number
  centerText?: boolean
  linesAround?: number
  textColor?: Color
  titleColor?: Color
}): string {
  const terminalWidth = process.stderr.columns || preferredWidth + BOX_OVERHEAD
  const useSimpleMode = terminalWidth < minWidth + BOX_OVERHEAD

  const wrapTarget = useSimpleMode
    ? Math.max(20, terminalWidth - SIMPLE_OVERHEAD)
    : Math.min(preferredWidth, terminalWidth - BOX_OVERHEAD)

  const wrappedLines = wrapLines(
    normalizeBannerText(text).split('\n'),
    wrapTarget,
  )

  const bannerLines = useSimpleMode
    ? buildSimpleBanner(wrappedLines, title, wrapTarget, textColor, titleColor)
    : buildBoxBanner(
        wrappedLines,
        title,
        wrapTarget,
        centerText,
        textColor,
        titleColor,
      )
  let banner = bannerLines.join('\n')

  if (linesAround && linesAround > 0) {
    const surroundingLines = '\n'.repeat(linesAround)
    banner = `${surroundingLines}${banner}${surroundingLines}`
  }
  return banner
}

// Decodes &nbsp; and forces markdown links onto their own line.
// Skips inserting \n if one is already adjacent so existing blank lines are preserved.
export function normalizeBannerText(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(
      /\[[^\]\n]+\]\([^)\n]+\)[.,;:!?]?/g,
      (match: string, offset: number, full: string) => {
        const before = offset === 0 || full[offset - 1] === '\n' ? '' : '\n'
        const afterIdx = offset + match.length
        const after =
          afterIdx === full.length || full[afterIdx] === '\n' ? '' : '\n'
        return `${before}${match}${after}`
      },
    )
}

// Word-wraps on whitespace; tokens longer than `width` overflow on their own line.
export function wrapLines(lines: string[], width: number): string[] {
  if (width <= 0) return lines
  const out: string[] = []
  for (const line of lines) {
    if (line.length <= width) {
      out.push(line)
      continue
    }
    let current = ''
    for (const word of line.split(/\s+/).filter(Boolean)) {
      if (!current) current = word
      else if (current.length + 1 + word.length <= width) current += ' ' + word
      else {
        out.push(current)
        current = word
      }
    }
    if (current) out.push(current)
  }
  return out
}

function buildSimpleBanner(
  lines: string[],
  title: string | undefined,
  maxLength: number,
  textColor: Color | undefined,
  titleColor: Color | undefined,
): string[] {
  const bannerLines: string[] = []

  if (title) {
    bannerLines.push(coloredText(title, titleColor))
    bannerLines.push(HORIZONTAL_LINE.repeat(Math.min(title.length, maxLength)))
  } else {
    bannerLines.push(HORIZONTAL_LINE.repeat(maxLength))
  }

  lines.forEach(line => {
    bannerLines.push(coloredText(line, textColor))
  })

  bannerLines.push(HORIZONTAL_LINE.repeat(maxLength))
  return bannerLines
}

function buildBoxBanner(
  lines: string[],
  title: string | undefined,
  maxLength: number,
  centerText: boolean | undefined,
  textColor: Color | undefined,
  titleColor: Color | undefined,
): string[] {
  const bannerLines: string[] = []

  // Top border with optional title
  if (title) {
    const totalPadding = Math.max(0, maxLength - title.length)
    const leftPad = Math.floor(totalPadding / 2)
    const rightPad = totalPadding - leftPad
    const coloredTitle = coloredText(title, titleColor)
    bannerLines.push(
      `${LEFT_CORNER}${HORIZONTAL_LINE.repeat(leftPad)} ${coloredTitle} ${HORIZONTAL_LINE.repeat(rightPad)}${RIGHT_CORNER}`,
    )
  } else {
    bannerLines.push(
      `${LEFT_CORNER}${HORIZONTAL_LINE.repeat(maxLength + 2)}${RIGHT_CORNER}`,
    )
  }

  // Oversized lines emit without padding; their right border slips past the box edge.
  lines.forEach(line => {
    const coloredLine = coloredText(line, textColor)
    const overflow = Math.max(0, maxLength - line.length)
    if (centerText) {
      const leftPad = Math.floor(overflow / 2)
      const rightPad = overflow - leftPad
      bannerLines.push(
        `${VERTICAL_LINE} ${' '.repeat(leftPad)}${coloredLine}${' '.repeat(rightPad)} ${VERTICAL_LINE}`,
      )
    } else {
      bannerLines.push(
        `${VERTICAL_LINE} ${coloredLine}${' '.repeat(overflow)} ${VERTICAL_LINE}`,
      )
    }
  })

  // Bottom border
  bannerLines.push(
    `${BOTTOM_LEFT_CORNER}${HORIZONTAL_LINE.repeat(maxLength + 2)}${BOTTOM_RIGHT_CORNER}`,
  )

  return bannerLines
}

const RESET = '\x1b[0m'

export enum Color {
  Bold = '\x1b[1m', // Same as Bright
  Dim = '\x1b[2m',
  Italic = '\x1b[3m',
  Underline = '\x1b[4m',
  Reverse = '\x1b[7m',
  Strikethrough = '\x1b[9m',

  // Regular foreground colors (30-37)
  Black = '\x1b[30m',
  Red = '\x1b[31m',
  Green = '\x1b[32m',
  Yellow = '\x1b[33m',
  Blue = '\x1b[34m',
  Magenta = '\x1b[35m',
  Cyan = '\x1b[36m',
  White = '\x1b[37m',
}

function isSupportsColor(): boolean {
  if (!process.stderr.isTTY) {
    return false
  }
  // Check environment variables
  const { TERM, COLORTERM, NO_COLOR, CI } = process.env
  // Explicitly disabled
  if (NO_COLOR !== undefined || CI === 'true') {
    return false
  }
  // Explicitly enabled
  if (COLORTERM === 'truecolor' || COLORTERM === '24bit') {
    return true
  }
  // Check TERM variable
  if (TERM && TERM !== 'dumb') {
    return true
  }
  return false
}

function coloredText(text: string, color?: Color): string {
  if (color && isSupportsColor()) {
    return `${color}${text}${RESET}`
  }
  return text
}
