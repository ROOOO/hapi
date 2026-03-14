import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    codexLocalCalls: [] as unknown[],
    sessionScannerCalls: [] as unknown[],
    scannerFailureMessage: 'No Codex session found within 120000ms for cwd c:\\workspace\\project; refusing fallback.'
}));

vi.mock('./codexLocal', () => ({
    codexLocal: async (opts: unknown) => {
        harness.codexLocalCalls.push(opts);
    }
}));

vi.mock('./utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async () => ({
        server: {
            url: 'http://127.0.0.1:12345/',
            stop: () => {}
        },
        mcpServers: {
            hapi: {
                command: 'bun',
                args: ['src/index.ts', 'mcp']
            }
        }
    })
}));

vi.mock('./utils/codexSessionScanner', () => ({
    createCodexSessionScanner: async (opts: {
        onSessionMatchFailed?: (message: string) => void;
    }) => {
        harness.sessionScannerCalls.push(opts);
        opts.onSessionMatchFailed?.(harness.scannerFailureMessage);
        return {
            cleanup: async () => {},
            onNewSession: () => {}
        };
    }
}));

import { codexLocalLauncher } from './codexLocalLauncher';

function createQueueStub() {
    return {
        size: () => 0,
        reset: () => {},
        setOnMessage: () => {}
    };
}

function createSessionStub() {
    const sessionEvents: Array<{ type: string; message?: string }> = [];
    const foundSessionIds: string[] = [];
    let localLaunchFailure: { message: string; exitReason: 'switch' | 'exit' } | null = null;

    const session = {
        path: 'C:\\workspace\\project',
        sessionId: null as string | null,
        client: {
            rpcHandlerManager: {
                registerHandler: () => {}
            }
        },
        queue: createQueueStub(),
        startedBy: 'terminal' as const,
        startingMode: 'local' as const,
        codexArgs: undefined,
        onSessionFound(id: string) {
            foundSessionIds.push(id);
            session.sessionId = id;
        },
        sendSessionEvent(event: { type: string; message?: string }) {
            sessionEvents.push(event);
        },
        recordLocalLaunchFailure(message: string, exitReason: 'switch' | 'exit') {
            localLaunchFailure = { message, exitReason };
        }
    };

    return {
        session,
        sessionEvents,
        foundSessionIds,
        getLocalLaunchFailure: () => localLaunchFailure
    };
}

describe('codexLocalLauncher', () => {
    afterEach(() => {
        harness.codexLocalCalls = [];
        harness.sessionScannerCalls = [];
    });

    it('warns on session match failure without aborting local Codex launch', async () => {
        const { session, sessionEvents, getLocalLaunchFailure } = createSessionStub();

        const exitReason = await codexLocalLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.sessionScannerCalls).toHaveLength(1);
        expect(harness.codexLocalCalls).toHaveLength(1);
        expect(getLocalLaunchFailure()).toBeNull();
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: `${harness.scannerFailureMessage} Keeping local Codex running; remote transcript sync may be unavailable for this launch.`
        });
    });
});
