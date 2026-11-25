import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENTS = ['session-start', 'task-complete', 'need-input', 'idle', 'error'];

/** Used whenever the user has not picked a theme. */
export const DEFAULT_THEME = 'default';

/**
 * Formats the platform players decode without extra codecs: Media Foundation
 * covers these on Windows, Core Audio (afplay) on macOS. Ogg/Opus are absent on
 * purpose — Windows ships no decoder and afplay refuses them. Order is priority,
 * so an existing .mp3 theme keeps winning over a sibling .wav.
 */
export const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.wma', '.aiff', '.aif', '.caf'];

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOUNDS_DIR = path.join(PLUGIN_ROOT, 'sounds');

/** `<base>.<ext>` in `dir` for the first supported extension that exists. */
function findAudio(dir, base) {
  for (const ext of AUDIO_EXTS) {
    const file = path.join(dir, `${base}${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export function isAudioFile(file) {
  return AUDIO_EXTS.includes(path.extname(String(file ?? '')).toLowerCase());
}

export function listThemes() {
  try {
    return fs
      .readdirSync(SOUNDS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => findAudio(path.join(SOUNDS_DIR, name), 'task-complete') !== null)
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
  return findAudio(themeDir(effectiveTheme(theme)), event);
}

export function describeTheme(theme) {
  const dir = themeDir(theme);
  let count = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!isAudioFile(entry)) continue;
      count += 1;
      bytes += fs.statSync(path.join(dir, entry)).size;
    }
  } catch {
    return { theme, count: 0, bytes: 0 };
  }
  return { theme, count, bytes };
}
