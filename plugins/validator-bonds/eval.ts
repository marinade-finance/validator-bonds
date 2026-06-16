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
  if (!data.question || !Array.isArray(data.facts))
    throw new Error(`invalid case: ${file}`)
  return data
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
    'Output YES if the response conveys the fact, including equivalent technical terms or numeric formatting. Output NO if absent or contradicted. No other output.'

  const runClaude = (flags: string[], prompt: string): Promise<string> =>
    $`claude ${flags} -p ${prompt}`
      .cwd(runRoot)
      .env({ ...process.env, CLAUDE_EVAL: '1' })
      .text()

  const checkFact = async (
    answer: string,
    fact: string,
  ): Promise<FactResult> => {
    if (answer.toLowerCase().includes(fact.toLowerCase()))
      return { fact, passed: true, method: 'exact' }

    try {
      const prompt = `Fact: ${fact}\n\nResponse:\n${answer}`
      const verdict = await runClaude(
        ['--bare', '--system-prompt', judgePrompt, '--model', judgeModel],
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
      const testCase = await readCase(file)
      const answer = await runClaude(claudeFlags, testCase.question)
      const facts = await Promise.all(
        testCase.facts.map(fact => checkFact(answer, fact)),
      )
      const wrongFacts = (testCase.wrong_facts ?? []).map(fact => ({
        fact,
        passed: !answer.toLowerCase().includes(fact.toLowerCase()),
        method: 'exact',
      }))
      const ok =
        facts.every(fact => fact.passed) &&
        wrongFacts.every(fact => fact.passed)

      log.cases.push({
        case: name,
        result: ok ? 'pass' : 'fail',
        question: testCase.question,
        answer: answer.trim(),
        facts,
        ...(wrongFacts.length ? { wrong_facts: wrongFacts } : {}),
      })

      if (ok) {
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
    }

    await mkdir(join(reportRoot, tag), { recursive: true })
    const reportPath = join(
      reportRoot,
      tag,
      `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.yml`,
    )
    await writeFile(reportPath, stringify(log))

    console.log(`\n${passed}/${passed + failed} passed -> ${reportPath}`)
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  }

  if (failed > 0) process.exitCode = 1
}
