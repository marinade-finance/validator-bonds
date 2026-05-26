#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const PLACEHOLDER = '__MIXPANEL_TOKEN_PLACEHOLDER__'

function die(msg) {
  console.error(`inject-mixpanel-token: ${msg}`)
  process.exit(1)
}

const token = process.env.MIXPANEL_TOKEN
const required = process.env.MIXPANEL_TOKEN_REQUIRED === '1'
if (!token || token.length === 0) {
  if (required) {
    die('MIXPANEL_TOKEN env var must be set and non-empty for publish builds')
  }
  console.log(
    'inject-mixpanel-token: MIXPANEL_TOKEN unset — skipping injection (dry-run / pack).',
  )
  process.exit(0)
}
if (token === PLACEHOLDER) {
  die('MIXPANEL_TOKEN must not equal the placeholder value')
}
if (!/^[A-Za-z0-9]+$/.test(token)) {
  die('MIXPANEL_TOKEN contains unexpected characters')
}

const distDir = path.join(process.cwd(), 'dist')
if (!fs.existsSync(distDir)) {
  die(`dist/ not found in ${process.cwd()} — run build first`)
}

let totalFiles = 0
let totalReplacements = 0
let totalMapsRemoved = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
    } else if (entry.isFile() && /\.js$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf-8')
      if (!content.includes(PLACEHOLDER)) continue
      const occurrences = content.split(PLACEHOLDER).length - 1
      const replaced = content.split(PLACEHOLDER).join(token)
      fs.writeFileSync(full, replaced)
      totalFiles += 1
      totalReplacements += occurrences
      console.log(
        `  ${path.relative(process.cwd(), full)} — ${occurrences} replacement(s)`,
      )
    }
  }
}

// .js.map files would still reference pre-injection byte offsets after rewrite,
// so drop them from the published artifact. .d.ts.map files reference .d.ts and
// stay valid.
function stripJsSourceMaps(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      stripJsSourceMaps(full)
    } else if (entry.isFile() && /\.js\.map$/.test(entry.name)) {
      fs.unlinkSync(full)
      totalMapsRemoved += 1
    }
  }
}

walk(distDir)

if (totalReplacements === 0) {
  die(
    'no occurrences of placeholder found in dist/ — either build did not run or the placeholder constant was renamed',
  )
}

stripJsSourceMaps(distDir)

console.log(
  `inject-mixpanel-token: ${totalReplacements} replacement(s) across ${totalFiles} file(s); removed ${totalMapsRemoved} .js.map file(s)`,
)
