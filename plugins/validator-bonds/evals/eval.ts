#!/usr/bin/env bun
// Usage: bun eval.ts [--plugin-dir <path>] [--no-skills] [--tmpdir] [-l|--list] [-v|--verbose] [-t <tag>] [-N|--limit N] [cases-dir|file.yaml...]
// Each .yaml: { question: string, facts: string[], wrong_facts?: string[] }
// --plugin-dir    load only this plugin; skills auto-trigger based on routing
// --no-skills     disable all skills (baseline comparison)
// --tmpdir        run claude in a fresh tmp dir (source only, cleaned after)
// -l / --list     print case names + questions without running them
// -v / --verbose  print full answer to stdout as each case runs
// -t <tag>        output tag (default: YYYYMMDD); written to evals/report/<tag>/
// -N / --limit N  run only first N cases
// Positionals default to ./cases relative to this script.
// Run in dockbox for clean isolation (fresh home = no global skills, ANTHROPIC_API_KEY forwarded).
// facts: must appear in answer. wrong_facts: must NOT appear (adversarial check).

import { parseArgs } from 'node:util'
import { parse, stringify } from 'yaml'
import { $ } from 'bun'
import {
  readdir,
  readFile,
  stat,
  mkdir,
  writeFile,
  rm,
  mkdtemp,
} from 'fs/promises'
import { join, basename, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

interface FactResult {
  fact: string
  passed: boolean
  method: 'exact' | 'haiku' | 'error'
  error?: string
}

const rawArgs = Bun.argv.slice(2)
const shortLimit = rawArgs.find(a => /^-\d+$/.test(a))
const filteredArgs = shortLimit
  ? rawArgs.filter(a => a !== shortLimit)
  : rawArgs

const { values, positionals } = parseArgs({
  args: filteredArgs,
  options: {
    'plugin-dir': { type: 'string' },
    'no-skills': { type: 'boolean', default: false },
    tmpdir: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    l: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    v: { type: 'boolean', default: false },
    t: { type: 'string' },
    limit: { type: 'string' },
  },
  allowPositionals: true,
})

const listMode = values.list || values.l
const verbose = values.verbose || values.v

const limit = shortLimit
  ? parseInt(shortLimit.slice(1), 10)
  : values.limit
    ? parseInt(values.limit, 10)
    : null

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = join(scriptDir, '../../..')

// --tmpdir: run claude in a fresh isolated dir, clean up after
let repoRoot = defaultRepoRoot
let tmpRoot: string | null = null
if (values.tmpdir) {
  tmpRoot = await mkdtemp(join(tmpdir(), 'vb-eval-'))
  console.log(`tmpdir: ${tmpRoot}`)
  // hard-link source into tmp; strip large dirs the model doesn't need
  await $`cp -al ${defaultRepoRoot}/. ${tmpRoot}/`
  await $`rm -rf ${tmpRoot}/{node_modules,.git,.refs,.pnpm-store}`
  repoRoot = tmpRoot
}

const defaultCasesDir = join(scriptDir, 'cases')
const casePaths = positionals.length > 0 ? positionals : [defaultCasesDir]

const today = new Date()
const defaultTag = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
const tag = values.t ?? defaultTag

// Resolve plugin-dir relative to original cwd before repoRoot changes
const pluginDir = values['plugin-dir']
  ? resolve(values['plugin-dir'])
  : undefined
const baseFlags = values['no-skills']
  ? ['--disable-slash-commands']
  : pluginDir
    ? ['--plugin-dir', pluginDir]
    : []

// Run claude from repo root: gives it .refs/, source code, CLAUDE.md, full tool access.
// Keeps it away from evals/cases/ so it can't read expected facts.
const ask = async (question: string): Promise<string> =>
  $`claude ${baseFlags} -p ${question}`
    .cwd(repoRoot)
    .env({ ...process.env, CLAUDE_EVAL: '1' })
    .text()

const judgePrompt =
  'You are a fact-checker. Given a fact and a response, output YES if the response conveys that fact — including via paraphrase, synonyms, or equivalent technical terms. Output NO only if the fact is absent or contradicted. No other output.'

const supports = async (answer: string, fact: string): Promise<FactResult> => {
  if (answer.toLowerCase().includes(fact.toLowerCase()))
    return { fact, passed: true, method: 'exact' }
  try {
    const prompt = `Fact: ${fact}\n\nResponse:\n${answer}`
    const raw =
      await $`claude --bare --system-prompt ${judgePrompt} --model claude-haiku-4-5-20251001 -p ${prompt}`
        .env({ ...process.env, CLAUDE_EVAL: '1' })
        .text()
    const verdict = raw.trim()
    return {
      fact,
      passed: verdict.toUpperCase() === 'YES',
      method: 'haiku',
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { fact, passed: false, method: 'error', error }
  }
}

const expand = async (p: string): Promise<string[]> => {
  if ((await stat(p)).isDirectory())
    return (await readdir(p))
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort()
      .map(f => join(p, f))
  if (!p.endsWith('.yaml') && !p.endsWith('.yml'))
    throw new Error(`not a YAML file: ${p}`)
  return [p]
}

let files = (await Promise.all(casePaths.map(expand))).flat()

if (files.length === 0) throw new Error('No .yaml/.yml files found')
if (limit !== null) files = files.slice(0, limit)

if (listMode) {
  for (const file of files) {
    const name = basename(file).replace(/\.ya?ml$/, '')
    const {
      question,
      facts,
      wrong_facts = [],
    } = parse(await readFile(file, 'utf8')) as {
      question: string
      facts: string[]
      wrong_facts?: string[]
    }
    console.log(`${name}`)
    console.log(`  Q: ${question.trim().replace(/\n/g, ' ')}`)
    console.log(`  facts: ${facts.join(', ')}`)
    if (wrong_facts.length)
      console.log(`  wrong_facts: ${wrong_facts.join(', ')}`)
  }
  process.exit(0)
}

let passed = 0
let failed = 0
const meta = {
  mode: values['no-skills']
    ? 'no-skills'
    : pluginDir
      ? `plugin:${pluginDir}`
      : 'default',
  flags: baseFlags,
  ...(pluginDir && !values['no-skills'] ? { plugin_dir: pluginDir } : {}),
  tag,
  started_at: new Date().toISOString(),
}
const log = { meta, cases: [] as unknown[] }

for (const file of files) {
  const name = basename(file).replace(/\.ya?ml$/, '')
  const {
    question,
    facts,
    wrong_facts = [],
  } = parse(await readFile(file, 'utf8')) as {
    question: string
    facts: string[]
    wrong_facts?: string[]
  }
  if (!question || !Array.isArray(facts))
    throw new Error('invalid case file: missing question or facts')
  try {
    const answer = await ask(question)
    const factResults = await Promise.all(facts.map(f => supports(answer, f)))
    const wrongResults = await Promise.all(
      wrong_facts.map(async f => {
        const r = await supports(answer, f)
        return { ...r, passed: !r.passed }
      }),
    )
    const ok =
      factResults.every(r => r.passed) && wrongResults.every(r => r.passed)
    log.cases.push({
      case: name,
      result: ok ? 'pass' : 'fail',
      question,
      answer: answer.trim(),
      facts: factResults,
      ...(wrongResults.length > 0 ? { wrong_facts: wrongResults } : {}),
    })
    if (ok) {
      console.log(`✓  ${name}`)
      passed++
    } else {
      console.log(`✗  ${name}`)
      factResults.forEach(r => {
        const tag = r.passed ? '  ok' : 'miss'
        console.log(`     [${tag}] ${r.fact}`)
      })
      wrongResults.forEach(r => {
        const tag = r.passed ? '  ok' : 'WRONG'
        console.log(`     [${tag}] wrong_fact: ${r.fact}`)
      })
      failed++
    }
    if (verbose) console.log(`\n--- answer ---\n${answer.trim()}\n`)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log.cases.push({ case: name, result: 'error', question, error, facts: [] })
    console.log(`!  ${name}  (error: ${error.slice(0, 80)})`)
    failed++
  }
}

const reportDir = join(scriptDir, 'report', tag)
await mkdir(reportDir, { recursive: true })
const logPath = join(
  reportDir,
  `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.yml`,
)
await writeFile(logPath, stringify(log))
console.log(`\n${passed}/${passed + failed} passed  →  ${logPath}`)
if (tmpRoot) {
  await rm(tmpRoot, { recursive: true, force: true })
  console.log(`cleaned up ${tmpRoot}`)
}
if (failed > 0) process.exit(1)
