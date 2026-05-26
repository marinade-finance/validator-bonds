#!/usr/bin/env bun
// Usage: bun runner.ts [--plugin-dir <path>] [--no-skills] <cases-dir|file.yaml...>
// Each .yaml: { question: string, facts: string[] }
// --plugin-dir  load only this plugin; skills auto-trigger based on routing
// --no-skills   disable all skills (baseline comparison)
// Run in dockbox for clean isolation (fresh home = no global skills, ANTHROPIC_API_KEY forwarded).
// Facts checked with includes() first; semantic misses go to haiku.
// Writes a detailed YAML log to ./tmp/eval-<timestamp>.yml

import { parseArgs } from 'node:util'
import { parse, stringify } from 'yaml'
import { $ } from 'bun'
import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises'
import { join, basename } from 'path'

interface Case {
  question: string
  facts: string[]
}

interface FactResult {
  fact: string
  passed: boolean
  method: 'exact' | 'haiku'
  haiku_verdict?: string
}

interface CaseResult {
  case: string
  result: 'pass' | 'fail'
  question: string
  answer: string
  facts: FactResult[]
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    'plugin-dir': { type: 'string' },
    'no-skills': { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

if (positionals.length === 0)
  throw new Error(
    'Usage: bun runner.ts [--plugin-dir <path>] [--no-skills] <cases-dir|file.yaml...>',
  )

const pluginDir = values['plugin-dir']
const baseFlags = values['no-skills']
  ? ['--disable-slash-commands']
  : pluginDir
    ? ['--plugin-dir', pluginDir]
    : []

const ask = async (question: string): Promise<string> =>
  $`claude ${baseFlags} -p ${question}`.text()

const judgePrompt = 'Answer YES or NO only. No explanation.'

const supports = async (answer: string, fact: string): Promise<FactResult> => {
  if (answer.includes(fact)) return { fact, passed: true, method: 'exact' }
  const raw =
    await $`claude --system-prompt ${judgePrompt} --model claude-haiku-4-5-20251001 -p ${`Does the response below support this fact?\nFact: ${fact}\nResponse: ${answer}`}`.text()
  const verdict = raw.trim()
  return {
    fact,
    passed: verdict.startsWith('YES'),
    method: 'haiku',
    haiku_verdict: verdict,
  }
}

const expand = async (p: string): Promise<string[]> => {
  const s = await stat(p)
  if (s.isDirectory())
    return (await readdir(p))
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort()
      .map(f => join(p, f))
  return [p]
}

const files = (await Promise.all(positionals.map(expand))).flat()

if (files.length === 0) throw new Error('No .yaml files found')

let passed = 0
let failed = 0
const log: CaseResult[] = []

for (const file of files) {
  const { question, facts } = parse(await readFile(file, 'utf8')) as Case
  const answer = await ask(question)
  const factResults = await Promise.all(facts.map(f => supports(answer, f)))
  const ok = factResults.every(r => r.passed)

  const entry: CaseResult = {
    case: basename(file, '.yaml'),
    result: ok ? 'pass' : 'fail',
    question,
    answer: answer.trim(),
    facts: factResults,
  }
  log.push(entry)

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
}

await mkdir('./tmp', { recursive: true })
const logPath = `./tmp/eval-${new Date().toISOString().replace(/[:.]/g, '-')}.yml`
await writeFile(logPath, stringify(log))
console.log(`\n${passed}/${passed + failed} passed  →  ${logPath}`)
if (failed > 0) throw new Error(`${failed} case(s) failed`)
