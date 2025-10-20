/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

import {
  CliCommandError,
  IsBigInt,
  parseAndValidate,
} from '@marinade.finance/cli-common'
import { getContext } from '@marinade.finance/ts-common'
import { IsPublicKey } from '@marinade.finance/web3js-1x'
import { PublicKey } from '@solana/web3.js'
import { Expose, Transform, Type } from 'class-transformer'
import { ValidateNested, IsPositive, IsNumber } from 'class-validator'

export class TreeNode {
  @Expose()
  @IsPublicKey({ message: 'Invalid stake authority public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly stake_authority!: PublicKey

  @Expose()
  @IsPublicKey({ message: 'Invalid withdraw authority public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly withdraw_authority!: PublicKey

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly claim!: bigint

  @Expose()
  @IsNumber()
  readonly index!: number

  @Expose()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value.map((proofItem: number[]) => Uint8Array.from(proofItem))
    } else {
      console.error('Expected an array for proof, but got:', value)
      throw new Error('Invalid proof format')
    }
  })
  readonly proof!: Uint8Array[]
}

export class MerkleTree {
  @Expose()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return Uint8Array.from(value)
    } else {
      console.error('Expected an array for merkle_root, but got:', value)
      throw new Error('Invalid merkle_root format')
    }
  })
  readonly merkle_root!: Uint8Array

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly max_total_claim_sum!: bigint

  @Expose()
  @IsNumber()
  readonly max_total_claims!: number

  @Expose()
  @IsPublicKey({ message: 'Invalid vote account public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly vote_account!: PublicKey

  @Expose()
  @ValidateNested({ each: true })
  @Type(() => TreeNode)
  readonly tree_nodes!: TreeNode[]
}

export class SettlementMerkleTreesDto {
  @Expose()
  @IsPositive()
  readonly epoch!: number

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly slot!: bigint

  @Expose()
  @ValidateNested({ each: true })
  @Type(() => MerkleTree)
  readonly merkle_trees!: MerkleTree[]
}

export async function parseSettlementMerkleTree(
  inputJson: string,
  path?: string,
): Promise<SettlementMerkleTreesDto> {
  const { logger } = getContext()
  try {
    const { data: merkleTreeData } =
      await parseAndValidate<SettlementMerkleTreesDto>(
        inputJson,
        SettlementMerkleTreesDto,
      )
    logger.debug(
      'Settlement Merkle Trees loaded successfully [epoch: %s, merkle_trees: %s]',
      merkleTreeData.epoch,
      merkleTreeData.merkle_trees.length,
    )
    return merkleTreeData
  } catch (error) {
    throw CliCommandError.instance(
      `Failed to load and validate settlement merkle tree data from path: '${path}'`,
      error,
    )
  }
}
