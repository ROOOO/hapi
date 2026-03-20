import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export type MachineDirectoryEntry = {
    name: string
    path: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type MachineDirectoryResponse = {
    success: boolean
    path?: string
    parentPath?: string | null
    entries?: MachineDirectoryEntry[]
    error?: string
}

export async function listMachineDirectory(path: string | undefined, defaultDirectory: string): Promise<MachineDirectoryResponse> {
    const targetPath = typeof path === 'string' && path.trim().length > 0
        ? resolve(path.trim())
        : resolve(defaultDirectory)

    try {
        const targetStats = await stat(targetPath)
        if (!targetStats.isDirectory()) {
            return { success: false, error: 'Selected path is not a directory' }
        }

        const entries = await readdir(targetPath, { withFileTypes: true })
        const directoryEntries: MachineDirectoryEntry[] = await Promise.all(
            entries.map(async (entry) => {
                const fullPath = join(targetPath, entry.name)
                let type: 'file' | 'directory' | 'other' = 'other'
                let size: number | undefined
                let modified: number | undefined

                if (entry.isDirectory()) {
                    type = 'directory'
                } else if (entry.isFile()) {
                    type = 'file'
                }

                if (!entry.isSymbolicLink()) {
                    try {
                        const entryStats = await stat(fullPath)
                        size = entryStats.size
                        modified = entryStats.mtime.getTime()
                    } catch {
                        // Keep entry visible even if stat fails.
                    }
                }

                return {
                    name: entry.name,
                    path: fullPath,
                    type,
                    size,
                    modified
                }
            })
        )

        directoryEntries.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1
            if (a.type !== 'directory' && b.type === 'directory') return 1
            return a.name.localeCompare(b.name)
        })

        const parentPath = dirname(targetPath)
        return {
            success: true,
            path: targetPath,
            parentPath: parentPath === targetPath ? null : parentPath,
            entries: directoryEntries
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list machine directory'
        }
    }
}
