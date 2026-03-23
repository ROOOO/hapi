import { describe, expect, it, vi } from 'vitest'
import { maybeOfferWindowsRunnerAutostart } from './windowsAutostart'

function createDeps(initialSettings: {
    runnerAutoStartWhenRunningHappy?: boolean
} = {}, overrides: Partial<Parameters<typeof maybeOfferWindowsRunnerAutostart>[1]> = {}) {
    let settings = { ...initialSettings }

    const deps: NonNullable<Parameters<typeof maybeOfferWindowsRunnerAutostart>[1]> = {
        isWindows: () => true,
        isRunnerProcess: () => false,
        isInteractive: () => true,
        readSettings: vi.fn(async () => settings as any),
        updateSettings: vi.fn(async (updater) => {
            settings = updater(settings as any) as typeof settings
            return settings as any
        }),
        getTaskStatus: vi.fn(() => 'missing' as const),
        installTask: vi.fn(async () => {}),
        promptUser: vi.fn(async () => true),
        log: vi.fn(),
        warn: vi.fn(),
        ...overrides
    }

    return {
        deps,
        getSettings: () => settings
    }
}

describe('maybeOfferWindowsRunnerAutostart', () => {
    it('prompts, installs, and remembers the choice when the user accepts', async () => {
        const { deps, getSettings } = createDeps()

        await maybeOfferWindowsRunnerAutostart({ startedBy: 'terminal' }, deps)

        expect(deps.promptUser).toHaveBeenCalledOnce()
        expect(deps.installTask).toHaveBeenCalledOnce()
        expect(deps.updateSettings).toHaveBeenCalledOnce()
        expect(getSettings().runnerAutoStartWhenRunningHappy).toBe(true)
    })

    it('remembers a declined prompt and does not install the task', async () => {
        const { deps, getSettings } = createDeps({}, {
            promptUser: vi.fn(async () => false)
        })

        await maybeOfferWindowsRunnerAutostart({ startedBy: 'terminal' }, deps)

        expect(deps.promptUser).toHaveBeenCalledOnce()
        expect(deps.installTask).not.toHaveBeenCalled()
        expect(deps.updateSettings).toHaveBeenCalledOnce()
        expect(getSettings().runnerAutoStartWhenRunningHappy).toBe(false)
    })

    it('reinstalls the task without prompting when the user already opted in', async () => {
        const { deps, getSettings } = createDeps({
            runnerAutoStartWhenRunningHappy: true
        }, {
            isInteractive: () => false
        })

        await maybeOfferWindowsRunnerAutostart({ startedBy: 'terminal' }, deps)

        expect(deps.promptUser).not.toHaveBeenCalled()
        expect(deps.installTask).toHaveBeenCalledOnce()
        expect(deps.updateSettings).not.toHaveBeenCalled()
        expect(getSettings().runnerAutoStartWhenRunningHappy).toBe(true)
    })

    it('skips the prompt for runner-started child sessions', async () => {
        const { deps } = createDeps()

        await maybeOfferWindowsRunnerAutostart({ startedBy: 'runner' }, deps)

        expect(deps.promptUser).not.toHaveBeenCalled()
        expect(deps.installTask).not.toHaveBeenCalled()
        expect(deps.updateSettings).not.toHaveBeenCalled()
    })

    it('adopts an existing task and marks autostart as enabled', async () => {
        const { deps, getSettings } = createDeps({}, {
            getTaskStatus: vi.fn(() => 'valid' as const)
        })

        await maybeOfferWindowsRunnerAutostart({ startedBy: 'terminal' }, deps)

        expect(deps.promptUser).not.toHaveBeenCalled()
        expect(deps.installTask).not.toHaveBeenCalled()
        expect(deps.updateSettings).toHaveBeenCalledOnce()
        expect(getSettings().runnerAutoStartWhenRunningHappy).toBe(true)
    })

    it('reinstalls a stale existing task and marks autostart as enabled', async () => {
        const { deps, getSettings } = createDeps({}, {
            getTaskStatus: vi.fn(() => 'stale' as const)
        })

        await maybeOfferWindowsRunnerAutostart({ startedBy: 'terminal' }, deps)

        expect(deps.promptUser).not.toHaveBeenCalled()
        expect(deps.installTask).toHaveBeenCalledOnce()
        expect(deps.updateSettings).toHaveBeenCalledOnce()
        expect(getSettings().runnerAutoStartWhenRunningHappy).toBe(true)
    })
})
