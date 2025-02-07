import { Command, CommanderError } from 'commander';
import { version } from '../package.json';

import { createFromRoot } from 'codama';
import { rootNodeFromAnchor, AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";
import anchorIdl from '/home/chalda/marinade/validator-bonds/resources/idl/validator_bonds.json';
import path from 'path';

const program = new Command();

program
  .name('codama-generate')
  .description('Codama client generator')
  .version(version);

program
  .description('Generate Codama client')
  .option('-o, --output <directory>', 'Where client should be generated', path.join(__dirname, '..', '..', '..', 'packages', 'validator-bonds-codama', 'src'))
  .action((options: { output: string }) => {
    const codama = createFromRoot(rootNodeFromAnchor(anchorIdl as AnchorIdl));
    const outputDir = path.join(options.output);
    codama.accept(
      renderJavaScriptVisitor(outputDir)
    );
  });

// Error handling
program.exitOverride();

try {
  program.parse(process.argv);
} catch (err) {
    if (err && err instanceof CommanderError && err.code === 'commander.help') {
        process.exit(0);
    }
    
    if (err && err instanceof Error) {
        console.error('Error:', err.message);
    }
    process.exit(1);
}