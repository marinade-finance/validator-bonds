import { installCheckMerkleTree } from './checkMerkleTree'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installCheckMerkleTree(program)
}
