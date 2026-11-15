import * as fs from 'fs'

import { createPool, createTypeParserPreset } from 'slonik'

import type { DatabasePool } from 'slonik'

export async function createEventingPool(
  postgresUrl: string,
  postgresSslRootCert: string | undefined,
): Promise<DatabasePool> {
  const poolConfig: Parameters<typeof createPool>[1] = {
    typeParsers: [
      ...createTypeParserPreset(),
      {
        name: 'timestamptz',
        parse: (timestamp: string) => new Date(timestamp).toISOString(),
      },
      {
        name: 'numeric',
        parse: (numeric: string) => numeric,
      },
    ],
    maximumPoolSize: 5,
  }

  if (postgresSslRootCert) {
    const ca = fs.readFileSync(postgresSslRootCert, 'utf8')
    ;(poolConfig as Record<string, unknown>).ssl = {
      rejectUnauthorized: true,
      ca: [ca],
    }
  }

  return createPool(postgresUrl, poolConfig)
}
