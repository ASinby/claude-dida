import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENTS = ['session-start', 'task-complete', 'need-input', 'idle', 'error'];

/** Used whenever the user has not picked a theme. */
export const DEFAULT_THEME = 'default';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOUNDS_DIR = path.join(PLUGIN_ROOT, 'sounds');

export function listThemes() {
  try {
    return fs
      .readdirSync(SOUNDS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(SOUNDS_DIR, name, 'task-complete.mp3')))
      .sort();
  } catch {
    return [];
  }
}

export function listEvents() {
  return [...EVENTS];
}

export function themeDir(theme) {
  return path.join(SOUNDS_DIR, theme);
}

/** The theme actually used for playback: the chosen one, else `default`. */
export function effectiveTheme(theme) {
  return theme || DEFAULT_THEME;
}

export function resolveSound(theme, event, config = {}) {
  const override = config.overrides?.[event];
  if (override && fs.existsSync(override)) return override;
  const file = path.join(themeDir(effectiveTheme(theme)), `${event}.mp3`);
  return fs.existsSync(file) ? file : null;
}

export function describeTheme(theme) {
  const dir = themeDir(theme);
  let count = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.mp3')) continue;
      count += 1;
      bytes += fs.statSync(path.join(dir, entry)).size;
    }
  } catch {
    return { theme, count: 0, bytes: 0 };
  }
  return { theme, count, bytes };
}
