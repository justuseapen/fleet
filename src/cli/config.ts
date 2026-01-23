import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { FleetGlobalConfig } from '../types.js';
import { defaultGlobalConfig } from '../types.js';

const FLEET_DIR = join(homedir(), '.fleet');
const CONFIG_PATH = join(FLEET_DIR, 'config.json');

/**
 * Load global Fleet configuration
 */
export function loadGlobalConfig(): FleetGlobalConfig {
    if (!existsSync(CONFIG_PATH)) {
        return { ...defaultGlobalConfig };
    }

    try {
        const content = readFileSync(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(content) as Partial<FleetGlobalConfig>;
        return { ...defaultGlobalConfig, ...config };
    } catch {
        return { ...defaultGlobalConfig };
    }
}

/**
 * Save global Fleet configuration
 */
export function saveGlobalConfig(config: FleetGlobalConfig): void {
    if (!existsSync(FLEET_DIR)) {
        mkdirSync(FLEET_DIR, { recursive: true });
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof FleetGlobalConfig>(
    key: K
): FleetGlobalConfig[K] {
    const config = loadGlobalConfig();
    return config[key];
}

/**
 * Set a specific config value
 */
export function setConfigValue<K extends keyof FleetGlobalConfig>(
    key: K,
    value: FleetGlobalConfig[K]
): void {
    const config = loadGlobalConfig();
    config[key] = value;
    saveGlobalConfig(config);
}
