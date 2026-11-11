import type { Pressure } from '../types'

export type UsageReading = {
  tokens?: number
  window: number
  breakdown?: { totalTokens: number; rawMaxTokens: number; autoCompactThreshold?: number; isAutoCompactEnabled: boolean }
}

// The status line divides by the model's whole window; what matters is how close auto-compaction is.
export function pressureOf(reading: UsageReading): Pressure | null {
  const b = reading.breakdown
  const used = reading.tokens ?? b?.totalTokens
  if (used === undefined) return null
  const compactAt = b?.isAutoCompactEnabled ? b.autoCompactThreshold : undefined
  const limit = compactAt ?? b?.rawMaxTokens ?? reading.window
  if (!limit) return null

  return { used, limit, percent: Math.round((used / limit) * 100), isCompactPoint: compactAt !== undefined }
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

export function label(p: Pressure) {
  const mark = p.percent >= 90 ? '‼' : p.percent >= 75 ? '⚠' : ''
  return `${mark}ctx ${p.percent}%/${k(p.limit)}`
}
