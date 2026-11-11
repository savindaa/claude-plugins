import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Pressure } from '../types'
import { label, pressureOf } from './pressure'

const pressureAtom = atom({ plugin: 'statusline', key: 'pressure' } as const, null)
const agentCostAtom = atom({ plugin: 'statusline', key: 'agentCost' } as const, 0)
const MIN_GAP_MS = 2_000
// Shorter responses arrive in a burst and give a meaningless rate.
const MIN_SPEED_WINDOW_MS = 250

let lastAt = 0

const API = 'https://api.anthropic.com'
const OAUTH_BETA = 'oauth-2025-04-20'

type Account = {
  name?: string
  email?: string
  org?: string
  orgName?: string
  profileStatus: number
  probeStatus?: number
  headers?: Record<string, string>
}

const configDir = async ($: Engine) => (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`

const cacheDir = async ($: Engine) => `${await configDir($)}/cache/statusline`

// The status line script has no plugin API, so it reads these files keyed by session.
async function sharedPath($: Engine, kind: 'ctx' | 'account' | 'cost' | 'speed') {
  return `${await cacheDir($)}/${kind}-${await $.session.id()}.json`
}

async function share($: Engine, kind: 'ctx' | 'account' | 'cost' | 'speed', value: unknown) {
  await $.fs.write(await sharedPath($, kind), JSON.stringify(value))
}

// The installed plugin's folder is versioned, so settings point at a stable copy of the script.
async function installScript($: Engine) {
  const script = await $.fs.read(`${$.plugin.root}/statusline.sh`)
  const target = `${await cacheDir($)}/statusline.sh`
  const current = await $.fs.read(target).catch(() => undefined)
  if (current !== script) await $.fs.write(target, script)
}

const costNow = async ($: Engine) => (await $.session.usage()).cost?.usd

// A resumed session restores the engine's total, so restore the subagents' share of it too.
async function restoreAgentCost($: Engine) {
  const saved = JSON.parse(await $.fs.read(await sharedPath($, 'cost'))) as { agents?: number }
  if (typeof saved.agents === 'number') await update($, agentCostAtom, spent => Math.max(spent, saved.agents ?? 0))
}

// The login record on disk can name another account than the session's token, so ask the server.
async function probeAccount($: Engine): Promise<Account | undefined> {
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return undefined
  const headers = { 'anthropic-beta': OAUTH_BETA, 'content-type': 'application/json' }
  const profile = await $.http.fetch(`${API}/api/oauth/profile`, { auth: auth.handle, headers })
  if (profile.ok) {
    const p = JSON.parse(profile.text) as {
      account?: { display_name?: string; email?: string }
      organization?: { uuid?: string; name?: string }
    }
    return {
      name: p.account?.display_name,
      email: p.account?.email,
      org: p.organization?.uuid,
      orgName: p.organization?.name,
      profileStatus: profile.status,
    }
  }
  // Setup tokens lack the profile scope; token counting is free and its response names the organization.
  const probe = await $.http.fetch(`${API}/v1/messages/count_tokens`, {
    method: 'POST',
    auth: auth.handle,
    headers: { ...headers, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x' }] }),
  })
  return {
    org: probe.headers['anthropic-organization-id'],
    profileStatus: profile.status,
    probeStatus: probe.status,
    headers: Object.fromEntries(Object.entries(probe.headers).filter(([k]) => k.startsWith('anthropic-'))),
  }
}

let loginSeenAt: number | undefined

const loginChangedAt = async ($: Engine) =>
  (await $.fs.stat(`${await configDir($)}/.credentials.json`).catch(() => undefined))?.mtimeMs

async function shareAccount($: Engine) {
  const changedAt = await loginChangedAt($)
  const account = await probeAccount($)
  if (!account) return
  await share($, 'account', account)
  loginSeenAt = changedAt
}

async function measure($: Engine, isForced = false) {
  const now = await $.clock.now()
  if (!isForced && now - lastAt < MIN_GAP_MS) return
  lastAt = now
  const usage = await $.session.usage({ breakdown: 'summary' })
  const p: Pressure | null = pressureOf({ ...usage.context, breakdown: usage.context.breakdown })
  const before = await read($, pressureAtom)
  if (before?.used === p?.used && before?.limit === p?.limit) return
  await update($, pressureAtom, () => p)
  if (p) await share($, 'ctx', p)
  if (p && p.percent >= 90 && (before?.percent ?? 0) < 90) $.ui.toast(`Context ${label(p)} — compaction is close`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await installScript($).catch(() => undefined)
    await measure($, true).catch(() => undefined)
    await shareAccount($).catch(() => undefined)
    await restoreAgentCost($).catch(() => undefined)

    return started
  })

  on('turn.step', async function* ($, e, next) {
    // The engine prices each response into one running total; a subagent step's share is the total's rise across it.
    // A main-thread step finishing inside a background subagent's step lands in the subagent's share.
    if (e.agentId !== undefined) {
      const before = await costNow($).catch(() => undefined)
      const response = yield* next(e)
      if (before === undefined) return response
      try {
        const after = await costNow($)
        if (after !== undefined && after > before) {
          const agents = await update($, agentCostAtom, spent => spent + after - before)
          await share($, 'cost', { agents })
        }
      } catch {}

      return response
    }

    const stream = next(e)
    let firstAt: number | undefined
    for await (const chunk of stream) {
      if (firstAt === undefined && chunk.kind !== 'engine') firstAt = await $.clock.now()
      yield chunk
    }
    const response = await stream.result
    try {
      const tokens = response.usage?.output_tokens ?? 0
      // Timed from the first streamed piece, so it is generation speed without the wait for the first token.
      const ms = firstAt === undefined ? 0 : (await $.clock.now()) - firstAt
      if (tokens > 0 && ms >= MIN_SPEED_WINDOW_MS) await share($, 'speed', { tps: (tokens * 1000) / ms })
    } catch {}

    return response
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await measure($, true).catch(() => undefined)
    if ((await loginChangedAt($).catch(() => undefined)) !== loginSeenAt) await shareAccount($).catch(() => undefined)

    return done
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) await measure($).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))
}
