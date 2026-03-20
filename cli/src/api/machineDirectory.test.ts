import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listMachineDirectory } from './machineDirectory'

async function createTempDir(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('listMachineDirectory', () => {
    let rootDir: string

    beforeEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }

        rootDir = await createTempDir('hapi-machine-dir')
        await mkdir(join(rootDir, 'alpha'), { recursive: true })
        await writeFile(join(rootDir, 'notes.txt'), 'hello')
    })

    it('lists the default directory when path is empty', async () => {
        const response = await listMachineDirectory('', rootDir)

        expect(response.success).toBe(true)
        expect(response.path).toBe(rootDir)
        expect((response.entries ?? []).map((entry) => entry.name)).toEqual(['alpha', 'notes.txt'])
    })

    it('returns a parent path when available', async () => {
        const childDir = join(rootDir, 'alpha')
        const response = await listMachineDirectory(childDir, rootDir)

        expect(response.success).toBe(true)
        expect(response.path).toBe(childDir)
        expect(response.parentPath).toBe(rootDir)
    })

    it('keeps broken symlinks visible as other entries', async () => {
        try {
            await symlink('/definitely-not-a-real-path', join(rootDir, 'bad-link'))
        } catch {
            return
        }

        const response = await listMachineDirectory('', rootDir)
        const entry = (response.entries ?? []).find((item) => item.name === 'bad-link')

        expect(response.success).toBe(true)
        expect(entry?.type).toBe('other')
        expect(entry?.size).toBeUndefined()
    })
})
