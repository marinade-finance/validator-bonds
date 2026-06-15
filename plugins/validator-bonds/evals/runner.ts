#!/usr/bin/env bun
// Usage: bun runner.ts [--plugin-dir <path>] [--no-skills] [-t <tag>] [-N] [cases-dir|file.yaml...]
// Each .yaml: { question: string, facts: string[] }
// --plugin-dir  load only this plugin; skills auto-trigger based on routing
// --no-skills   disable all skills (baseline comparison)
// -t <tag>      output tag (default: YYYYMMDD); written to ./report/<tag>/
// -N            run only first N cases (e.g. -1, -2, -3)
// Positionals default to ./cases relative to this script.
// Run in dockbox for clean isolation (fresh home = no global skills, ANTHROPIC_API_KEY forwarded).
// Facts: case-insensitive includes() first; semantic misses go to haiku with XML delimiters.

import { parseArgs } from 'node:util'
import { parse, stringify } from 'yaml'
import { $ } from 'bun'
import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

interface Case {
  question: string
  facts: string[]
}

interface FactResult {
  fact: string
  passed: boolean
  method: 'exact' | 'haiku' | 'error'
  haiku_verdict?: string
  error?: string
}

interface CaseResult {
  case: string
  result: 'pass' | 'fail' | 'error'
  question: string
  answer?: string
  error?: string
  facts: FactResult[]
}

interface RunMeta {
  mode: string
  flags: string[]
  plugin_dir?: string
  tag: string
  started_at: string
}

// Extract -N flags (e.g. -1, -2) before parseArgs since they're not valid option names
const rawArgs = Bun.argv.slice(2)
let limit: number | null = null
const filteredArgs = rawArgs.filter(a => {
  const m = a.match(/^-(\d+)$/)
  if (m) {
    limit = parseInt(m[1], 10)
    return false
  }
  return true
})

const { values, positionals } = parseArgs({
  args: filteredArgs,
  options: {
    'plugin-dir': { type: 'string' },
    'no-skills': { type: 'boolean', default: false },
    t: { type: 'string' },
  },
  allowPositionals: true,
})

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultCasesDir = join(scriptDir, 'cases')
const casePaths = positionals.length > 0 ? positionals : [defaultCasesDir]

const today = new Date()
const defaultTag = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
const tag = values.t ?? defaultTag

const pluginDir = values['plugin-dir']
const baseFlags = values['no-skills']
  ? ['--disable-slash-commands']
  : pluginDir
    ? ['--plugin-dir', pluginDir]
    : []

const ask = async (question: string): Promise<string> =>
  $`claude ${baseFlags} -p ${question}`
    .env({ ...process.env, CLAUDE_EVAL: '1' })
    .text()

const judgePrompt =
  'You are a strict fact-checker. Given a fact and a response, output the single word YES if the response explicitly and accurately conveys that fact, or the single word NO if absent, contradicted, or only vaguely implied. No other output.'

const supports = async (answer: string, fact: string): Promise<FactResult> => {
  if (answer.toLowerCase().includes(fact.toLowerCase()))
    return { fact, passed: true, method: 'exact' }
  try {
    const prompt = `<fact>${fact}</fact>\n<response>${answer}</response>`
    const raw =
      await $`claude --system-prompt ${judgePrompt} --model claude-haiku-4-5-20251001 -p ${prompt}`
        .env({ ...process.env, CLAUDE_EVAL: '1' })
        .text()
    const verdict = raw.trim()
    return {
      fact,
      passed: verdict.toUpperCase() === 'YES',
      method: 'haiku',
      haiku_verdict: verdict,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { fact, passed: false, method: 'error', error }
  }
}

const expand = async (p: string): Promise<string[]> => {
  const s = await stat(p)
  if (s.isDirectory())
    return (await readdir(p))
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort()
      .map(f => join(p, f))
  if (!p.endsWith('.yaml') && !p.endsWith('.yml'))
    throw new Error(`not a YAML file: ${p}`)
  return [p]
}

let files = (await Promise.all(casePaths.map(expand))).flat()

if (files.length === 0) throw new Error('No .yaml files found')
if (limit !== null) files = files.slice(0, limit)

let passed = 0
let failed = 0
const meta: RunMeta = {
  mode: values['no-skills']
    ? 'no-skills'
    : pluginDir
      ? `plugin:${pluginDir}`
      : 'default',
  flags: baseFlags,
  ...(pluginDir ? { plugin_dir: pluginDir } : {}),
  tag,
  started_at: new Date().toISOString(),
}
const log: { meta: RunMeta; cases: CaseResult[] } = { meta, cases: [] }

for (const file of files) {
  const { question, facts } = parse(await readFile(file, 'utf8')) as Case
  if (!question || !Array.isArray(facts))
    throw new Error('invalid case file: missing question or facts')
  let entry: CaseResult
  try {
    const answer = await ask(question)
    const factResults = await Promise.all(facts.map(f => supports(answer, f)))
    const ok = factResults.every(r => r.passed)
    entry = {
      case: basename(file).replace(/\.ya?ml$/, ''),
      result: ok ? 'pass' : 'fail',
      question,
      answer: answer.trim(),
      facts: factResults,
    }
    if (ok) {
      console.log(`✓  ${entry.case}`)
      passed++
    } else {
      console.log(`✗  ${entry.case}`)
      factResults.forEach(r => {
        if (!r.passed) console.log(`     missing: ${r.fact}`)
      })
      failed++
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    entry = {
      case: basename(file).replace(/\.ya?ml$/, ''),
      result: 'error',
      question,
      error,
      facts: [],
    }
    console.log(`!  ${entry.case}  (error: ${error.slice(0, 80)})`)
    failed++
  }
  log.cases.push(entry)
}

const reportDir = join('./report', tag)
await mkdir(reportDir, { recursive: true })
const logPath = join(
  reportDir,
  `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.yml`,
)
await writeFile(logPath, stringify(log))
console.log(`\n${passed}/${passed + failed} passed  →  ${logPath}`)
if (failed > 0) process.exit(1)
