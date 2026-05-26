#!/usr/bin/env bun
// Usage: bun runner.ts <cases-dir>
// Each .yaml in cases-dir: { q: string, facts: string[] }
// Facts are checked with includes() first; semantic misses go to haiku.

import { $ } from "bun"
import { readdir, readFile } from "fs/promises"
import { parse } from "yaml"
import { join, basename } from "path"

const dir = process.argv[2]
if (!dir) {
  console.error("Usage: bun runner.ts <cases-dir>")
  process.exit(1)
}

interface Case {
  q: string
  facts: string[]
}

async function ask(q: string): Promise<string> {
  return $`claude -p ${q}`.text()
}

async function supports(answer: string, fact: string): Promise<boolean> {
  if (answer.includes(fact)) { return true }
  const verdict = await $`claude --model claude-haiku-4-5-20251001 -p ${
    `Does the response below support this fact? Answer YES or NO only.\nFact: ${fact}\nResponse: ${answer}`
  }`.text()
  return verdict.trim().startsWith("YES")
}

const files = (await readdir(dir))
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .sort()

if (files.length === 0) {
  console.error(`No .yaml files found in ${dir}`)
  process.exit(1)
}

let passed = 0
let failed = 0

for (const file of files) {
  const { q, facts } = parse(await readFile(join(dir, file), "utf8")) as Case
  const answer = await ask(q)
  const results = await Promise.all(facts.map((f) => supports(answer, f)))
  const ok = results.every(Boolean)

  if (ok) {
    console.log(`✓  ${basename(file, ".yaml")}`)
    passed++
  } else {
    console.log(`✗  ${basename(file, ".yaml")}`)
    facts.forEach((f, i) => {
      if (!results[i]) console.log(`     missing: ${f}`)
    })
    failed++
  }
}

console.log(`\n${passed}/${passed + failed} passed`)
if (failed > 0) process.exit(1)
