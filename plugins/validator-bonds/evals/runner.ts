#!/usr/bin/env bun
// Usage: bun runner.ts [--no-skills] <cases-dir>
// Each .yaml in cases-dir: { question: string, facts: string[] }
// Facts checked with includes() first; semantic misses go to haiku.

import { parseArgs } from "node:util"
// eslint-disable-next-line import/no-extraneous-dependencies
import { parse } from "yaml"
import { $ } from "bun"
import { readdir, readFile } from "fs/promises"
import { join, basename } from "path"

interface Case {
  question: string
  facts: string[]
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "no-skills": { type: "boolean", default: false },
  },
  allowPositionals: true,
})

const dir = positionals[0]
if (!dir)
  throw new Error("Usage: bun runner.ts [--no-skills] <cases-dir>")

const extraFlags = values["no-skills"] ? ["--no-skills"] : []

const ask = async (question: string): Promise<string> =>
  $`claude ${extraFlags} -p ${question}`.text()

const supports = async (answer: string, fact: string): Promise<boolean> => {
  if (answer.includes(fact))
    return true
  const verdict = await $`claude --model claude-haiku-4-5-20251001 -p ${
    `Does the response below support this fact? Answer YES or NO only.\nFact: ${fact}\nResponse: ${answer}`
  }`.text()
  return verdict.trim().startsWith("YES")
}

const files = (await readdir(dir))
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .sort()

if (files.length === 0)
  throw new Error(`No .yaml files found in ${dir}`)

let passed = 0
let failed = 0

for (const file of files) {
  const { question, facts } = parse(
    await readFile(join(dir, file), "utf8"),
  ) as Case
  const answer = await ask(question)
  const results = await Promise.all(facts.map((f) => supports(answer, f)))
  const ok = results.every(Boolean)

  if (ok) {
    console.log(`✓  ${basename(file, ".yaml")}`)
    passed++
  } else {
    console.log(`✗  ${basename(file, ".yaml")}`)
    facts.forEach((f, i) => {
      if (!results[i])
        console.log(`     missing: ${f}`)
    })
    failed++
  }
}

console.log(`\n${passed}/${passed + failed} passed`)
if (failed > 0)
  throw new Error(`${failed} case(s) failed`)
