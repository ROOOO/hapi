import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MachineDirectoryEntry } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'

function formatDirectoryBrowserError(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) {
        return fallback
    }

    const jsonStart = error.message.indexOf('{')
    if (jsonStart >= 0) {
        try {
            const parsed = JSON.parse(error.message.slice(jsonStart)) as { error?: unknown; message?: unknown }
            if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
                return parsed.error
            }
            if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
                return parsed.message
            }
        } catch {
            // Fall back to the original message.
        }
    }

    return error.message
}

export function DirectoryBrowserDialog(props: {
    api: ApiClient
    open: boolean
    machineId: string | null
    initialPath?: string
    onOpenChange: (open: boolean) => void
    onSelect: (path: string) => void
}) {
    const { t } = useTranslation()
    const [entries, setEntries] = useState<MachineDirectoryEntry[]>([])
    const [currentPath, setCurrentPath] = useState('')
    const [parentPath, setParentPath] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const requestIdRef = useRef(0)

    const loadDirectory = useCallback(async (path?: string) => {
        if (!props.machineId) return

        const requestId = ++requestIdRef.current
        setIsLoading(true)
        setError(null)

        try {
            const response = await props.api.listMachineDirectory(props.machineId, path)
            if (requestId !== requestIdRef.current) return
            if (!response.success || !response.path) {
                throw new Error(response.error ?? t('newSession.browser.loadError'))
            }

            setEntries(response.entries ?? [])
            setCurrentPath(response.path)
            setParentPath(response.parentPath ?? null)
        } catch (error) {
            if (requestId !== requestIdRef.current) return
            setError(formatDirectoryBrowserError(error, t('newSession.browser.loadError')))
        } finally {
            if (requestId === requestIdRef.current) {
                setIsLoading(false)
            }
        }
    }, [props.api, props.machineId, t])

    useEffect(() => {
        if (!props.open || !props.machineId) return
        void loadDirectory(props.initialPath)
    }, [props.open, props.machineId, props.initialPath, loadDirectory])

    const handleSelectCurrent = useCallback(() => {
        if (!currentPath) return
        props.onSelect(currentPath)
        props.onOpenChange(false)
    }, [currentPath, props])

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('newSession.browser.title')}</DialogTitle>
                    <DialogDescription>{t('newSession.browser.description')}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm font-mono break-all">
                        {currentPath || props.initialPath || t('loading')}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => parentPath && loadDirectory(parentPath)}
                            disabled={!parentPath || isLoading}
                        >
                            {t('newSession.browser.up')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => loadDirectory(currentPath || props.initialPath)}
                            disabled={isLoading || (!currentPath && !props.initialPath)}
                        >
                            {t('newSession.browser.refresh')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSelectCurrent}
                            disabled={isLoading || !currentPath}
                        >
                            {t('newSession.browser.selectCurrent')}
                        </Button>
                    </div>

                    <div className="max-h-[50vh] overflow-y-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
                        {isLoading ? (
                            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-[var(--app-hint)]">
                                <Spinner size="sm" label={null} />
                                {t('newSession.browser.loading')}
                            </div>
                        ) : error ? (
                            <div className="px-4 py-6 text-sm text-red-600">{error}</div>
                        ) : entries.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-[var(--app-hint)]">{t('newSession.browser.empty')}</div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {entries.map((entry) => {
                                    const isDirectory = entry.type === 'directory'
                                    return (
                                        <button
                                            key={entry.path}
                                            type="button"
                                            onClick={() => isDirectory && loadDirectory(entry.path)}
                                            disabled={!isDirectory || isLoading}
                                            className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm ${
                                                isDirectory
                                                    ? 'hover:bg-[var(--app-subtle-bg)]'
                                                    : 'cursor-default text-[var(--app-hint)]'
                                            }`}
                                        >
                                            <span className="min-w-0 truncate font-mono">
                                                {isDirectory ? '📁' : entry.type === 'file' ? '📄' : '🔗'} {entry.name}
                                            </span>
                                            <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                                {isDirectory ? t('newSession.browser.enter') : t(`newSession.browser.type.${entry.type}`)}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)}>
                            {t('button.cancel')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
