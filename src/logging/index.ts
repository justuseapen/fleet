import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FLEET_DIR = join(homedir(), '.fleet');
const LOG_DIR = join(FLEET_DIR, 'logs');
const LOG_FILE = join(LOG_DIR, 'fleet.log');

function ensureLogDir(): void {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
    }
}

export interface LogEvent {
    level: 'debug' | 'info' | 'warn' | 'error';
    runId?: string;
    projectId?: string;
    message: string;
    details?: Record<string, unknown>;
}

export function logEvent(event: LogEvent): void {
    ensureLogDir();
    const logLine = JSON.stringify({
        timestamp: new Date().toISOString(),
        ...event,
    });
    try {
        appendFileSync(LOG_FILE, logLine + '\n');
    } catch {
        // Best-effort logging — don't crash the agent
    }
}
