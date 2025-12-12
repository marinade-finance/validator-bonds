/* eslint-disable @typescript-eslint/no-unsafe-assignment, n/no-process-exit, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'fs'
import path, { join } from 'path'

import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor as renderJavaScriptVisitor } from '@codama/renderers-js'
import { createFromRoot } from 'codama'
import { Command } from 'commander'

import { version } from '../package.json'

import type { AnchorIdl } from '@codama/nodes-from-anchor'

const idlPath = join(__dirname, '../../../resources/idl/validator_bonds.json')
const idlContent: string = readFileSync(idlPath, 'utf-8')
const anchorIdl: AnchorIdl = JSON.parse(idlContent)

interface ProgramOptions {
  output: string
}

const program = new Command()

program
  .name('codama-generate')
  .description('Codama client generator')
  .version(version)

program
  .description('Generate Codama client')
  .option(
    '-o, --output <directory>',
    'Where client should be generated',
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'validator-bonds-codama',
      'src',
    ),
  )
  .action((options: ProgramOptions) => {
    const codama = createFromRoot(rootNodeFromAnchor(anchorIdl as AnchorIdl))
    const outputDir = path.join(options.output)
    codama
      .accept(renderJavaScriptVisitor(outputDir))
      .then(() => {
        console.log('Client generated successfully')
      })
      .catch((err: unknown) => {
        console.error('Generation Error', err)
        process.exit(1)
      })
  })

try {
  program.parse(process.argv)
} catch (err: unknown) {
  console.error('Generator Error', err)
  process.exit(1)
}
