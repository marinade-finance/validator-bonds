import { Option } from 'commander'

import type { Command } from 'commander'

export function addSharedEventingOptions(command: Command): Command {
  return command
    .addOption(
      new Option('--bonds-api-url <url>', 'Validator bonds API base URL')
        .env('BONDS_API_URL')
        .default('https://validator-bonds-api.marinade.finance'),
    )
    .addOption(
      new Option(
        '--notifications-api-url <url>',
        'marinade-notifications base URL',
      ).env('NOTIFICATIONS_API_URL'),
    )
    .addOption(
      new Option(
        '--notifications-jwt <token>',
        'JWT for notifications API auth',
      ).env('NOTIFICATIONS_JWT'),
    )
    .addOption(
      new Option('--postgres-url <url>', 'PostgreSQL connection string').env(
        'POSTGRES_URL',
      ),
    )
    .addOption(
      new Option(
        '--postgres-ssl-root-cert <path>',
        'Path to SSL root cert',
      ).env('POSTGRES_SSL_ROOT_CERT'),
    )
    .addOption(
      new Option(
        '--retry-max-attempts <n>',
        'Max retries for notification POST',
      )
        .env('EVENTING_RETRY_MAX_ATTEMPTS')
        .default(4),
    )
    .addOption(
      new Option(
        '--retry-base-delay-ms <ms>',
        'Base delay for exponential backoff',
      )
        .env('EVENTING_RETRY_BASE_DELAY_MS')
        .default(30000),
    )
    .addOption(
      new Option(
        '--emit-concurrency <n>',
        'Number of events to POST in parallel',
      )
        .env('EVENTING_EMIT_CONCURRENCY')
        .default(20),
    )
    .addOption(
      new Option('--dry-run', 'Skip POST and DB write, just log events')
        .env('DRY_RUN')
        .default(false),
    )
}
