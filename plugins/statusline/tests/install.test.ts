import { expect, test } from 'claude-code/testing'

const TARGET = '/cfg/cache/statusline/statusline.sh'

test('copies the bundled script to the stable path only when it changed', async ($, on) => {
  let installed: string | undefined = 'old'
  const writes: string[] = []

  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.authorize', () => ({ deny: 'not under test' }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/statusline.sh') && e.path !== TARGET) return { value: 'new' }
    if (e.path === TARGET && installed !== undefined) return { value: installed }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    if (e.path === TARGET) {
      writes.push(e.text)
      installed = e.text
    }
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(writes).toEqual(['new'])

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(writes).toEqual(['new'])
})
