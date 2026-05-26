#!/usr/bin/env bun
// Usage: bun runner.ts [--skill-file <path>] <cases-dir|file.yaml...>
// Each .yaml: { question: string, facts: string[] }
// --skill-file  inject a SKILL.md via --append-system-prompt-file (with skill)
// omit          bare run, no skill (baseline)
// Facts checked with includes() first; semantic misses go to haiku.

import { parseArgs } from 'node:util'
import { parse } from 'yaml'
import { $ } from 'bun'
import { readdir, readFile, stat } from 'fs/promises'
import { join, basename } from 'path'

interface Case {
  question: string
  facts: string[]
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
const baseFlags = skillFile
  ? ['--bare', '--append-system-prompt-file', skillFile]
  : ['--bare']

const ask = async (question: string): Promise<string> =>
  $`claude ${baseFlags} -p ${question}`.text()

const supports = async (answer: string, fact: string): Promise<boolean> => {
  if (answer.includes(fact)) return true
  const verdict =
    await $`claude --bare --model claude-haiku-4-5-20251001 -p ${`Does the response below support this fact? Answer YES or NO only.\nFact: ${fact}\nResponse: ${answer}`}`.text()
  return verdict.trim().startsWith('YES')
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

for (const file of files) {
  const { question, facts } = parse(await readFile(file, 'utf8')) as Case
  const answer = await ask(question)
  const results = await Promise.all(facts.map(f => supports(answer, f)))
  const ok = results.every(Boolean)

  if (ok) {
    console.log(`✓  ${basename(file, '.yaml')}`)
    passed++
  } else {
    console.log(`✗  ${basename(file, '.yaml')}`)
    facts.forEach((f, i) => {
      if (!results[i]) console.log(`     missing: ${f}`)
    })
    failed++
  }
}

console.log(`\n${passed}/${passed + failed} passed`)
if (failed > 0) throw new Error(`${failed} case(s) failed`)
