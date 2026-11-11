import { expect, test } from 'claude-code/testing'

const CREDS = '/cfg/.credentials.json'
const ACCOUNT = '/cfg/cache/statusline/account-s1.json'

test('the account is probed again only when the login changes', async ($, on) => {
  let loginAt = 1_000
  let org = 'org-a'
  let probes = 0
  const shared: string[] = []

  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('fs.stat', (_, e) => {
    if (e.path !== CREDS) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 2, mtimeMs: loginAt, isLink: false } }
  })
  on('fs.write', (_, e) => {
    if (e.path === ACCOUNT) shared.push((JSON.parse(e.text) as { org: string }).org)
    return { value: undefined }
  })
  on('http.fetch', () => {
    probes++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ organization: { uuid: org } }) } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  const turn = () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(shared).toEqual(['org-a'])

  await turn()
  expect(probes).toBe(1)

  loginAt = 2_000
  org = 'org-b'
  await turn()
  expect(shared).toEqual(['org-a', 'org-b'])

  await turn()
  expect(probes).toBe(2)
})
