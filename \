/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, n/no-process-exit */
import path from 'path'

import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor as renderJavaScriptVisitor } from '@codama/renderers-js'
import { createFromRoot } from 'codama'
import { Command } from 'commander'

import { version } from '../package.json'

import type { AnchorIdl } from '@codama/nodes-from-anchor'

import anchorIdl from '/home/chalda/marinade/validator-bonds/resources/idl/validator_bonds.json'

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
  .action((options: { output: string }) => {
    const codama = createFromRoot(rootNodeFromAnchor(anchorIdl as AnchorIdl))
    const outputDir = path.join(options.output)
    codama.accept(renderJavaScriptVisitor(outputDir))
  })

try {
  program.parse(process.argv)
} catch (err) {
  console.error('Generator Error', err)
  process.exit(1)
}
