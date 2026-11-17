import * as fs from 'fs'

import { createPool, createTypeParserPreset } from 'slonik'

import type { ClientConfigurationInput, DatabasePool } from 'slonik'

export async function createEventingPool(
  postgresUrl: string,
  postgresSslRootCert: string | undefined,
): Promise<DatabasePool> {
  const ca = postgresSslRootCert
    ? fs.readFileSync(postgresSslRootCert, 'utf8')
    : undefined

  const poolConfig: ClientConfigurationInput = {
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
    maxPoolSize: 5,
    ...(ca === undefined
      ? {}
      : { ssl: { rejectUnauthorized: true, ca: [ca] } }),
  }

  return createPool(postgresUrl, poolConfig)
}
