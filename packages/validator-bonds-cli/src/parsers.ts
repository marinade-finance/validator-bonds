import BN from 'bn.js'

export function toBN(value: string): BN {
  return new BN(value.replace(/_/g, ''), 10)
}
