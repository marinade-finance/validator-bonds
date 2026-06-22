#!/usr/bin/env bun
/* eslint-disable import/no-extraneous-dependencies */

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from 'util'

import { $ } from 'bun'
import { parse, stringify } from 'yaml'

type CaseFile = {
  question: string
  facts: string[]
  wrong_facts?: string[]
}

type FactResult = {
  fact: string
  passed: boolean
  method: 'exact' | 'haiku' | 'error'
  error?: string
}

const rawArgs = Bun.argv.slice(2).filter(arg => arg !== '--')
const shorthandLimit = rawArgs.find(arg => /^-\d+$/.test(arg))
const args = shorthandLimit
  ? rawArgs.filter(arg => arg !== shorthandLimit)
  : rawArgs

const { values, positionals } = parseArgs({
  args,
  options: {
    'plugin-dir': { type: 'string' },
    'no-skills': { type: 'boolean', default: false },
    persist: { type: 'boolean', default: false },
    list: { type: 'boolean', short: 'l', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    t: { type: 'string' },
    limit: { type: 'string' },
    model: { type: 'string' },
  },
  allowPositionals: true,
})

const pluginRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(pluginRoot, '../..')
const casesRoot = join(pluginRoot, 'evals/cases')
const reportRoot = join(pluginRoot, 'evals/report')
const limit = shorthandLimit
  ? Number(shorthandLimit.slice(1))
  : values.limit
    ? Number(values.limit)
    : undefined
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
  throw new Error(`invalid limit: ${values.limit ?? shorthandLimit}`)

const modelAliases: Record<string, string> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
}

const model = values.model
  ? (modelAliases[values.model] ?? values.model)
  : undefined
const pluginDir = resolve(values['plugin-dir'] ?? '.')

const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
const tag = values.t ?? today

const copyRepo = async (src: string): Promise<string> => {
  const dest = await mkdtemp(join(tmpdir(), 'vb-eval-'))
  const excludes = ['node_modules', '.git', '.refs', '.pnpm-store'].flatMap(
    d => ['--exclude', `./${d}`],
  )
  await $`tar -cf - ${excludes} -C ${src} . | tar -xf - -C ${dest}`
  return dest
}

const expand = async (input: string): Promise<string[]> => {
  const path = input.includes('/')
    ? resolve(input)
    : join(casesRoot, `${input}.yml`)
  const s = await stat(path)
  if (!s.isDirectory()) return [path]
  return (await readdir(path))
    .filter(f => f.endsWith('.yml'))
    .sort()
    .map(f => join(path, f))
}

let files = (
  await Promise.all(
    (positionals.length ? positionals : [casesRoot]).map(expand),
  )
).flat()
if (limit !== undefined) files = files.slice(0, limit)

const readCase = async (file: string): Promise<CaseFile> => {
  const data = parse(await readFile(file, 'utf8')) as CaseFile
  const strings = (xs: unknown): boolean =>
    Array.isArray(xs) && xs.every(x => typeof x === 'string')
  if (
    !data.question ||
    !strings(data.facts) ||
    (data.wrong_facts !== undefined && !strings(data.wrong_facts))
  )
    throw new Error(`invalid case: ${file}`)
  return data
}

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Substring match for identifiers; for a pure number require it to stand alone
// (not flanked by a digit, dot, or comma) so `0.1` does not match inside
// `0.16`, nor `1,000` inside `1,000,000`.
const containsFact = (answer: string, fact: string): boolean => {
  const a = answer.toLowerCase()
  const f = fact.toLowerCase()
  if (/^\d[\d.,]*$/.test(f))
    return new RegExp(`(?<![\\d.,])${escapeRegExp(f)}(?![\\d.,])`).test(a)
  return a.includes(f)
}

if (values.list) {
  for (const file of files) {
    const data = await readCase(file)
    console.log(basename(file).replace(/\.yml$/, ''))
    console.log(`  Q: ${data.question.trim().replace(/\s+/g, ' ')}`)
    console.log(`  facts: ${data.facts.join(', ')}`)
    if (data.wrong_facts?.length)
      console.log(`  wrong_facts: ${data.wrong_facts.join(', ')}`)
  }
} else {
  let runRoot = repoRoot
  let runPluginDir = pluginDir
  let tempRoot: string | null = null

  if (!values.persist) {
    tempRoot = await copyRepo(repoRoot)
    runRoot = tempRoot

    if (!values['plugin-dir']) {
      const pluginRelativePath = relative(repoRoot, pluginDir)
      runPluginDir = join(tempRoot, pluginRelativePath)
    }
  }

  const claudeFlags = [
    ...(values['no-skills']
      ? ['--disable-slash-commands']
      : ['--plugin-dir', runPluginDir]),
    ...(model ? ['--model', model] : []),
  ]

  const judgeModel = 'claude-haiku-4-5-20251001'
  const judgePrompt =
    'Output YES if the response conveys the fact. Accept: equivalent technical terms, alternative numeric formatting (commas/underscores), or equivalent units (e.g. "200 SOL" ≡ "200000000000 lamports" or "200,000,000,000 lamports"; "20.0 SOL" ≡ "20 SOL"; "-3750 bps" ≡ "3750 basis points"). Output NO if absent or contradicted. No other output.'

  const runClaude = (flags: string[], prompt: string): Promise<string> =>
    $`claude ${flags} -p ${prompt}`.cwd(runRoot).text()

  const checkFact = async (
    answer: string,
    fact: string,
  ): Promise<FactResult> => {
    if (containsFact(answer, fact))
      return { fact, passed: true, method: 'exact' }

    try {
      const prompt = `Fact: ${fact}\n\nResponse:\n${answer}`
      const verdict = await runClaude(
        [
          '--disable-slash-commands',
          '--system-prompt',
          judgePrompt,
          '--model',
          judgeModel,
        ],
        prompt,
      )
      return {
        fact,
        passed: verdict.trim().toUpperCase() === 'YES',
        method: 'haiku',
      }
    } catch (error) {
      return {
        fact,
        passed: false,
        method: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let failed = 0
  let errored = 0

  try {
    let passed = 0
    const log = {
      meta: {
        mode: values['no-skills'] ? 'no-skills' : `plugin:${pluginDir}`,
        flags: claudeFlags,
        tag,
        started_at: new Date().toISOString(),
      },
      cases: [] as unknown[],
    }

    for (const file of files) {
      const name = basename(file).replace(/\.yml$/, '')
      try {
        const testCase = await readCase(file)
        const answer = await runClaude(claudeFlags, testCase.question)
        const facts = await Promise.all(
          testCase.facts.map(fact => checkFact(answer, fact)),
        )
        const wrongFacts = (testCase.wrong_facts ?? []).map(fact => ({
          fact,
          passed: !containsFact(answer, fact),
          method: 'exact',
        }))
        const judgeError = facts.some(fact => fact.method === 'error')
        const ok =
          facts.every(fact => fact.passed) &&
          wrongFacts.every(fact => fact.passed)
        const result = judgeError ? 'error' : ok ? 'pass' : 'fail'

        log.cases.push({
          case: name,
          result,
          question: testCase.question,
          answer: answer.trim(),
          facts,
          ...(wrongFacts.length ? { wrong_facts: wrongFacts } : {}),
        })

        if (judgeError) {
          console.log(`⚠ ${name}`)
          for (const fact of facts.filter(fact => fact.method === 'error'))
            console.log(`  judge error: ${fact.fact}: ${fact.error}`)
          errored++
        } else if (ok) {
          console.log(`✓ ${name}`)
          passed++
        } else {
          console.log(`✗ ${name}`)
          for (const fact of facts.filter(fact => !fact.passed))
            console.log(`  missing: ${fact.fact}`)
          for (const fact of wrongFacts.filter(fact => !fact.passed))
            console.log(`  wrong_fact: ${fact.fact}`)
          failed++
        }

        if (values.verbose)
          console.log(`\n--- ${name} answer ---\n${answer.trim()}\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.cases.push({ case: name, result: 'error', error: message })
        console.log(`⚠ ${name}`)
        console.log(`  error: ${message}`)
        errored++
      }
    }

    await mkdir(join(reportRoot, tag), { recursive: true })
    const reportPath = join(
      reportRoot,
      tag,
      `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.yml`,
    )
    await writeFile(reportPath, stringify(log))

    const errNote = errored ? `, ${errored} errored` : ''
    console.log(
      `\n${passed}/${passed + failed + errored} passed${errNote} -> ${reportPath}`,
    )
  } catch (error) {
    process.exitCode = 1
    throw error
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  }

  if (failed > 0 || errored > 0) process.exitCode = 1
}
