import type { PublicKey } from '@solana/web3.js'

const LEFT_CORNER = '╔'
const RIGHT_CORNER = '╗'
const HORIZONTAL_LINE = '═'
const VERTICAL_LINE = '║'
const BOTTOM_LEFT_CORNER = '╚'
const BOTTOM_RIGHT_CORNER = '╝'

export function printBanner(voteAccount: PublicKey): void {
  const banner = getBanner({
    title: 'Help us improve Marinade SAM ✓✓✓',
    text:
      '\n\nWe’d love your feedback! Please take a minute to fill out our short survey:\n' +
      `  https://docs.google.com/forms/d/e/1FAIpQLScnBKcKJsb4-wNSAzgrwrY5boAqG4Y_xsjo4YhND0TfdpUSfw/viewform?usp=pp_url&entry.976219744=${voteAccount.toBase58()}\n\n`,
    width: 80,
    centerText: true,
    linesAround: 1,
    textColor: Color.Bold,
  })
  console.log(banner)
}

export function getBanner({
  text,
  title,
  width,
  centerText,
  linesAround,
  textColor,
  titleColor = textColor,
}: {
  text: string
  title?: string
  width?: number
  centerText?: boolean
  linesAround?: number
  textColor?: Color
  titleColor?: Color
}): string {
  const lines = text.split('\n')

  let maxLength = Math.max(
    ...lines.map(l => l.length),
    title ? title.length : 0,
  )
  maxLength = width ? Math.max(maxLength, width) : maxLength

  const bannerLines: string[] = []

  // Top border with optional title
  if (title) {
    const totalPadding = maxLength - title.length
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

  // Content lines
  lines.forEach(line => {
    const coloredLine = coloredText(line, textColor)
    if (centerText) {
      const totalPadding = maxLength - line.length
      const leftPad = Math.floor(totalPadding / 2)
      const rightPad = totalPadding - leftPad
      bannerLines.push(
        `${VERTICAL_LINE} ${' '.repeat(leftPad)}${coloredLine}${' '.repeat(rightPad)} ${VERTICAL_LINE}`,
      )
    } else {
      const padding = ' '.repeat(maxLength - line.length)
      bannerLines.push(
        `${VERTICAL_LINE} ${coloredLine}${padding} ${VERTICAL_LINE}`,
      )
    }
  })

  // Bottom border
  bannerLines.push(
    `${BOTTOM_LEFT_CORNER}${HORIZONTAL_LINE.repeat(maxLength + 2)}${BOTTOM_RIGHT_CORNER}`,
  )

  let banner = bannerLines.join('\n')

  if (linesAround && linesAround > 0) {
    const surroundingLines = '\n'.repeat(linesAround)
    banner = `${surroundingLines}${banner}${surroundingLines}`
  }

  return banner
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
  // Check if output is a TTY (not piped/redirected)
  if (!process.stdout.isTTY) {
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
