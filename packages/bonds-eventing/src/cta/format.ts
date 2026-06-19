// Number/SOL formatting helpers ported verbatim from the psr-dashboard CTA
// engine (`src/format.ts` on branch 20260531_v2) so the CLI tips render the
// exact same wording as the dashboard.

export const finite = (x: number | null | undefined): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : 0

export const sol = (amount: number, digits = 0): string =>
  amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

export const stake = (n: number): string => `${sol(n, 0)} SOL`

export const topUp = (n: number): string => `${Math.ceil(n)} SOL`

export const pay = (n: number, digits = 0): string => {
  const p = Math.pow(10, digits)
  return `${sol(Math.ceil(finite(n) * p) / p, digits)} SOL`
}
