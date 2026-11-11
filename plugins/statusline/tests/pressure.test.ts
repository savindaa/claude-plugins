import { expect, test } from 'claude-code/testing'

import { label, pressureOf } from '../hooks/pressure'

const breakdown = { totalTokens: 90_000, rawMaxTokens: 200_000, autoCompactThreshold: 167_000, isAutoCompactEnabled: true }

test('measures the last response against the auto-compact point, not the whole window', async () => {
  const p = pressureOf({ tokens: 125_250, window: 1_000_000, breakdown })
  expect(p).toEqual({ used: 125_250, limit: 167_000, percent: 75, isCompactPoint: true })
  expect(p && label(p)).toBe('⚠ctx 75%/167k')
})

test('falls back to the estimate right after a compaction, and to the window when auto-compact is off', async () => {
  expect(pressureOf({ window: 200_000, breakdown })?.used).toBe(90_000)
  const off = pressureOf({ tokens: 50_000, window: 200_000, breakdown: { ...breakdown, isAutoCompactEnabled: false } })
  expect(off && label(off)).toBe('ctx 25%/200k')
})

test('nothing to show before the first response', async () => {
  expect(pressureOf({ window: 200_000 })).toBe(null)
})
