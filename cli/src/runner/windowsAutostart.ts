import chalk from 'chalk'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { configuration } from '@/configuration'
import { readSettings, updateSettings } from '@/persistence'
import { getHappyCliCommand } from '@/utils/spawnHappyCLI'
import { isWindows } from '@/utils/process'

export const WINDOWS_RUNNER_AUTOSTART_TASK_NAME = 'HAPI Runner Autostart'

const WINDOWS_RUNNER_AUTOSTART_SCRIPT = 'runner-autostart.ps1'

function quotePowerShellString(value: string): string {
    return `'${value.replace(/'/g, `''`)}'`
}

function renderPowerShellArray(values: string[]): string {
    return `@(${values.map((value) => quotePowerShellString(value)).join(', ')})`
}

function getWindowsPowerShellPath(): string {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const candidate = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return existsSync(candidate) ? candidate : 'powershell.exe'
}

function getWindowsRunnerAutostartScriptPath(): string {
    return join(configuration.happyHomeDir, WINDOWS_RUNNER_AUTOSTART_SCRIPT)
}

function buildWindowsRunnerAutostartScript(): string {
    const launcher = getHappyCliCommand(['runner', 'start'])
    const workingDirectory = homedir()

    return [
        `$ErrorActionPreference = 'Stop'`,
        `$env:HAPI_HOME = ${quotePowerShellString(configuration.happyHomeDir)}`,
        `$env:HAPI_API_URL = ${quotePowerShellString(configuration.apiUrl)}`,
        `$env:CLI_API_TOKEN = ${quotePowerShellString(configuration.cliApiToken)}`,
        `$arguments = ${renderPowerShellArray(launcher.args)}`,
        `Push-Location ${quotePowerShellString(workingDirectory)}`,
        `try {`,
        `    & ${quotePowerShellString(launcher.command)} @arguments`,
        `    exit $LASTEXITCODE`,
        `} finally {`,
        `    Pop-Location`,
        `}`
    ].join('\r\n')
}

function runWindowsPowerShell(script: string): ReturnType<typeof spawnSync> {
    return spawnSync(
        getWindowsPowerShellPath(),
        [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            script
        ],
        {
            encoding: 'utf8',
            stdio: 'pipe',
            windowsHide: true
        }
    )
}

function formatPowerShellError(result: ReturnType<typeof spawnSync>, fallback: string): Error {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const message = stderr || stdout || (result.error instanceof Error ? result.error.message : fallback)
    return new Error(message)
}

export function hasWindowsRunnerAutostartTask(): boolean {
    if (!isWindows()) {
        return false
    }

    const result = runWindowsPowerShell([
        `$task = Get-ScheduledTask -TaskName ${quotePowerShellString(WINDOWS_RUNNER_AUTOSTART_TASK_NAME)} -ErrorAction SilentlyContinue`,
        `if ($null -eq $task) { exit 1 }`,
        `exit 0`
    ].join('\n'))

    return result.status === 0
}

export async function installWindowsRunnerAutostartTask(): Promise<void> {
    if (!isWindows()) {
        throw new Error('Windows runner autostart is only supported on Windows.')
    }

    await mkdir(configuration.happyHomeDir, { recursive: true })

    const scriptPath = getWindowsRunnerAutostartScriptPath()
    await writeFile(scriptPath, buildWindowsRunnerAutostartScript(), 'utf8')

    const powerShellPath = getWindowsPowerShellPath()
    const actionArguments = `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"`
    const workingDirectory = homedir()
    const registerScript = [
        `$taskName = ${quotePowerShellString(WINDOWS_RUNNER_AUTOSTART_TASK_NAME)}`,
        `$userId = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\\$($env:USERNAME)" } else { $env:USERNAME }`,
        `$action = New-ScheduledTaskAction -Execute ${quotePowerShellString(powerShellPath)} -Argument ${quotePowerShellString(actionArguments)} -WorkingDirectory ${quotePowerShellString(workingDirectory)}`,
        `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId`,
        `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew`,
        `$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited`,
        `Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Start HAPI runner at user logon' -Force | Out-Null`
    ].join('\n')

    const result = runWindowsPowerShell(registerScript)
    if (result.status !== 0) {
        throw formatPowerShellError(result, 'Failed to register Windows runner autostart task.')
    }
}

async function promptToInstallWindowsRunnerAutostart(): Promise<boolean> {
    const rl = readline.createInterface({ input, output })

    console.log('')
    console.log(chalk.cyan('Windows runner autostart'))
    console.log(chalk.gray('  Install a Scheduled Task that runs `hapi runner start` when you sign in.'))
    console.log(chalk.gray('  This helps keep this machine visible in HAPI after a reboot.'))

    try {
        while (true) {
            const answer = (await rl.question(chalk.cyan('Install it now? [Y/n]: '))).trim().toLowerCase()
            if (!answer || answer === 'y' || answer === 'yes') {
                return true
            }
            if (answer === 'n' || answer === 'no') {
                return false
            }
            console.log(chalk.yellow('Please answer y or n.'))
        }
    } finally {
        rl.close()
    }
}

type WindowsRunnerAutostartDeps = {
    isWindows: () => boolean
    isRunnerProcess: () => boolean
    isInteractive: () => boolean
    readSettings: typeof readSettings
    updateSettings: typeof updateSettings
    taskExists: () => boolean
    installTask: () => Promise<void>
    promptUser: () => Promise<boolean>
    log: (message: string) => void
    warn: (message: string) => void
}

const defaultDeps: WindowsRunnerAutostartDeps = {
    isWindows,
    isRunnerProcess: () => configuration.isRunnerProcess,
    isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    readSettings,
    updateSettings,
    taskExists: hasWindowsRunnerAutostartTask,
    installTask: installWindowsRunnerAutostartTask,
    promptUser: promptToInstallWindowsRunnerAutostart,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message)
}

export async function maybeOfferWindowsRunnerAutostart(
    options: { startedBy?: 'runner' | 'terminal' },
    deps: WindowsRunnerAutostartDeps = defaultDeps
): Promise<void> {
    if (!deps.isWindows() || deps.isRunnerProcess() || options.startedBy === 'runner') {
        return
    }

    try {
        const settings = await deps.readSettings()
        const taskExists = deps.taskExists()

        if (taskExists) {
            if (settings.runnerAutoStartWhenRunningHappy !== true) {
                await deps.updateSettings((current) => ({
                    ...current,
                    runnerAutoStartWhenRunningHappy: true
                }))
            }
            return
        }

        if (settings.runnerAutoStartWhenRunningHappy === true) {
            await deps.installTask()
            deps.log(chalk.green('Installed Windows autostart task for hapi runner.'))
            return
        }

        if (!deps.isInteractive() || settings.runnerAutoStartWhenRunningHappy === false) {
            return
        }

        const shouldInstall = await deps.promptUser()
        if (!shouldInstall) {
            await deps.updateSettings((current) => ({
                ...current,
                runnerAutoStartWhenRunningHappy: false
            }))
            deps.log(chalk.gray('Skipped Windows runner autostart. Run `hapi runner install-autostart` later if you change your mind.'))
            return
        }

        await deps.installTask()
        await deps.updateSettings((current) => ({
            ...current,
            runnerAutoStartWhenRunningHappy: true
        }))
        deps.log(chalk.green('Installed Windows autostart task for hapi runner.'))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.warn(chalk.yellow(`Warning: Failed to configure Windows runner autostart: ${message}`))
    }
}
