#!/usr/bin/env bun
// Usage: bun runner.ts [--skill-file <path>] <cases-dir|file.yaml...>
// Each .yaml: { question: string, facts: string[] }
// --skill-file  SKILL.md to use as system prompt (with skill)
// omit          minimal system prompt, no skill (baseline)
// Uses --system-prompt to replace the default (prevents CLAUDE.md startup noise).
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
    'skill-file': { type: 'string' },
  },
  allowPositionals: true,
})

if (positionals.length === 0)
  throw new Error(
    'Usage: bun runner.ts [--skill-file <path>] <cases-dir|file.yaml...>',
  )

const skillFile = values['skill-file']

const stripFrontmatter = (content: string): string => {
  const parts = content.split('---\n', 3)
  return parts.length >= 3 ? parts[2].trim() : content.trim()
}

const systemPrompt = skillFile
  ? stripFrontmatter(await readFile(skillFile, 'utf8'))
  : 'You are a helpful assistant. Answer questions directly and concisely.'

const ask = async (question: string): Promise<string> =>
  $`claude --system-prompt ${systemPrompt} -p ${question}`.text()

const supports = async (answer: string, fact: string): Promise<FactResult> => {
  if (answer.includes(fact)) return { fact, passed: true, method: 'exact' }
  const judgePrompt = 'Answer YES or NO only. No explanation.'
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
