import { CliCommandError } from '@marinade.finance/cli-common'
import { DECIMAL_ZERO, getContext, loadFile } from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'

import { parseSettlementMerkleTree } from '../dtoMerkleTree'
import { parseSettlements } from '../dtoSettlements'

import type { Command } from 'commander'

export function installCheckSettlement(program: Command) {
  program
    .command('check-settlement')
    .description(
      'Check settlements.json and settlement-merkle-trees.json consistency',
    )
    .requiredOption('-s, --settlements <path>', 'Path to settlements.json file')
    .requiredOption(
      '-m, --merkle-trees <path>',
      'Path to settlement-merkle-trees.json file',
    )
    .action(manageCheckSettlement)
}

async function manageCheckSettlement({
  settlements,
  merkleTrees,
}: {
  settlements: string
  merkleTrees: string
}) {
  const { logger } = getContext()
  logger.info(
    `Loading settlement and merkle tree files [${settlements}, ${merkleTrees}]`,
  )

  const settlementsData = await loadFile(settlements)
  const merkleTreesData = await loadFile(merkleTrees)

  const settlementsDto = await parseSettlements(
    settlementsData,
    settlementsData,
  )
  const merkleTreesDto = await parseSettlementMerkleTree(
    merkleTreesData,
    merkleTreesData,
  )

  logger.debug(
    `Loaded settlements from ${settlements} and merkle trees from ${merkleTrees}`,
  )

  // Check 0: Epoch comparison
  if (settlementsDto.epoch !== merkleTreesDto.epoch) {
    throw CliCommandError.instance(
      `Mismatch in epochs: Settlements(${settlementsDto.epoch}) vs Merkle Trees(${merkleTreesDto.epoch})`,
    )
  } else {
    logger.info(`Epochs match: ${settlementsDto.epoch}`)
  }

  // Check 1: Count comparison
  const settlementsCount = settlementsDto.settlements.length
  const merkleTreesCount = merkleTreesDto.merkle_trees.length
  if (settlementsCount !== merkleTreesCount) {
    throw CliCommandError.instance(
      `Mismatch in number of settlements and merkle tree count: Settlements(${settlementsCount}) vs Merkle Trees(${merkleTreesCount})`,
    )
  }
  logger.info(`✓ Count [${settlementsCount}] check passed`)

  // Check 2: Sum comparison
  const settlementsSum = settlementsDto.settlements.reduce(
    (total, settlement) => {
      const settlementSum = settlement.claims.reduce(
        (sum, claim) => sum.plus(claim.claim_amount),
        DECIMAL_ZERO,
      )
      return total.plus(settlementSum)
    },
    DECIMAL_ZERO,
  )

  const merkleTreesSum = merkleTreesDto.merkle_trees.reduce(
    (total, tree) => total.plus(new Decimal(tree.max_total_claim_sum)),
    DECIMAL_ZERO,
  )
  logger.info(
    `Settlements sum: ${settlementsSum.toString()}, Merkle trees sum: ${merkleTreesSum.toString()}`,
  )

  if (!settlementsSum.equals(merkleTreesSum)) {
    const errorMsg =
      `Mismatch in total settlements and merkle tree claim amount: Settlements(${settlementsSum.toString()}) ` +
      `vs Merkle Trees(${merkleTreesSum.toString()})`
    logger.error(errorMsg)
    throw CliCommandError.instance(errorMsg)
  }

  logger.info('✓ Sum check passed')
}
