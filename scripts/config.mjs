import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EVENTS = ['task-complete', 'need-input', 'idle', 'error', 'session-start'];

export const DEFAULTS = {
  theme: null,
  volume: 0.7,
  enabled: true,
  events: {
    'task-complete': true,
    'need-input': true,
    idle: true,
    error: true,
    'session-start': true,
  },
  subagentStop: false,
  dedupeMs: 1500,
  playbackMode: 'detach',
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  overrides: {},
};

// Deliberately ignores CLAUDE_PLUGIN_DATA: hooks receive it but Bash-driven slash
// commands do not, so honoring it would split config between two directories.
export function dataDir() {
  return path.join(os.homedir(), '.claude-dida');
}

export function configPath() {
  return path.join(dataDir(), 'config.json');
}

export function logPath() {
  return path.join(dataDir(), 'error.log');
}

export function ensureDataDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
  return dataDir();
}

function mergeDefaults(raw) {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULTS);
  const config = { ...structuredClone(DEFAULTS), ...raw };
  config.events = { ...DEFAULTS.events, ...(raw.events ?? {}) };
  config.quietHours = { ...DEFAULTS.quietHours, ...(raw.quietHours ?? {}) };
  config.overrides = raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {};
  return config;
}

export function readConfig() {
  try {
    const text = fs.readFileSync(configPath(), 'utf8');
    return mergeDefaults(JSON.parse(text));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function writeConfig(config) {
  ensureDataDir();
  const target = configPath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
  return config;
}

export function updateConfig(patch) {
  return writeConfig(mergeDefaults({ ...readConfig(), ...patch }));
}

export function setKey(key, value) {
  const config = readConfig();
  const [head, leaf] = key.split('.');
  const parsed = coerce(key, value);

  if (leaf) {
    if (typeof config[head] !== 'object' || config[head] === null) config[head] = {};
    config[head][leaf] = parsed;
  } else {
    config[head] = parsed;
  }
  return writeConfig(config);
}

function coerce(key, value) {
  if (key === 'theme') return value === 'null' || value === '' ? null : value;
  if (key === 'volume') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : value;
  }
  if (key === 'dedupeMs') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : value;
  }
  if (key === 'enabled' || key === 'subagentStop' || key.startsWith('events.')) {
    return value === 'true' || value === '1' || value === true;
  }
  if (key === 'quietHours.enabled') return value === 'true' || value === '1' || value === true;
  return value;
}

export function isQuietNow(config, now = new Date()) {
  const quiet = config.quietHours;
  if (!quiet?.enabled) return false;

  const toMinutes = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };

  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === null || end === null) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function logError(message) {
  try {
    ensureDataDir();
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(logPath(), line, 'utf8');
    const stat = fs.statSync(logPath());
    if (stat.size > 64 * 1024) {
      const lines = fs.readFileSync(logPath(), 'utf8').split('\n').slice(-200);
      fs.writeFileSync(logPath(), lines.join('\n'), 'utf8');
    }
  } catch {
    // logging must never break playback
  }
}
