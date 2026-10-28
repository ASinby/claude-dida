import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logError } from './config.mjs';

const PLATFORM = process.platform;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(SCRIPT_DIR, 'win-play.vbs');
const PLAY_SCRIPT = path.join(SCRIPT_DIR, 'win-play.ps1');

function clampVolume(volume) {
  const n = Number(volume);
  if (!Number.isFinite(n)) return 0.7;
  return Math.min(1, Math.max(0, n));
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * wscript.exe is a GUI-subsystem program: no console, no window, and it outlives
 * the parent. That lets it start a hidden console-subsystem PowerShell, which a
 * detached Node spawn cannot do directly.
 *
 * Resolved by path rather than `where` so playback never pays for an extra process.
 */
function wscriptPath() {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  const candidate = path.join(root, 'System32', 'wscript.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

function hiddenLauncher() {
  const wscript = wscriptPath();
  if (!wscript) return null;
  if (!fs.existsSync(LAUNCHER) || !fs.existsSync(PLAY_SCRIPT)) return null;
  return { wscript, launcher: LAUNCHER };
}

function windowsHiddenCommand(launcher, file, volume, inline) {
  return {
    type: 'argv',
    command: launcher.wscript,
    // //B keeps a failing VBS from opening a modal dialog that hangs forever.
    args: ['//nologo', '//B', launcher.launcher, file, String(clampVolume(volume)), inline ? '1' : '0'],
  };
}

function windowsLegacyCommand(file, volume) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = ${clampVolume(volume)}
$player.Open([uri]${psString(file)})
$player.Play()
$guard = 0
while (-not $player.NaturalDuration.HasTimeSpan -and $guard -lt 200) {
  Start-Sleep -Milliseconds 25
  $guard++
}
$ms = if ($player.NaturalDuration.HasTimeSpan) { $player.NaturalDuration.TimeSpan.TotalMilliseconds } else { 800 }
Start-Sleep -Milliseconds ([int]$ms + 150)
$player.Close()
`.trim();
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  // -EncodedCommand keeps the payload to A-Za-z0-9+/= so cmd.exe never re-parses quotes.
  const line = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`;
  // Fallback only: `shell: true` flashes a console window, but it always plays.
  return { type: 'cmdline', line };
}

function windowsCommand(file, volume, inline) {
  const launcher = hiddenLauncher();
  if (launcher) return windowsHiddenCommand(launcher, file, volume, inline);
  return windowsLegacyCommand(file, volume);
}

function whichAll(candidates) {
  const found = [];
  for (const name of candidates) {
    const probe =
      PLATFORM === 'win32'
        ? spawnSync('where', [name], { stdio: 'ignore', windowsHide: true })
        : spawnSync('command', ['-v', name], { stdio: 'ignore', shell: true });
    if (probe.status === 0) found.push(name);
  }
  return found;
}

function macCommand(file, volume) {
  return { type: 'argv', command: 'afplay', args: [file, '-v', String(clampVolume(volume))] };
}

function linuxCommand(file, volume) {
  const found = whichAll(['paplay', 'ffplay', 'mpv']);
  const pct = Math.round(clampVolume(volume) * 100);
  if (found.includes('paplay')) {
    // paplay has no per-invocation volume flag; it follows PulseAudio's sink volume.
    return { type: 'argv', command: 'paplay', args: [file] };
  }
  if (found.includes('ffplay')) {
    return { type: 'argv', command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(pct), file] };
  }
  if (found.includes('mpv')) {
    return { type: 'argv', command: 'mpv', args: ['--no-video', '--really-quiet', `--volume=${pct}`, file] };
  }
  return null;
}

export function buildCommand(file, volume, inline = false) {
  if (PLATFORM === 'win32') return windowsCommand(file, volume, inline);
  if (PLATFORM === 'darwin') return macCommand(file, volume);
  return linuxCommand(file, volume);
}

export function detectPlayer() {
  if (PLATFORM === 'win32') {
    const launcher = hiddenLauncher();
    const probe = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    const ok = probe.status === 0;
    const version = ok ? `PowerShell ${String(probe.stdout).trim()}` : String(probe.stderr ?? '').trim() || 'PowerShell not found';
    if (!ok) {
      return { platform: 'win32', backend: 'powershell MediaPlayer', available: false, detail: version };
    }
    if (launcher) {
      return { platform: 'win32', backend: 'wscript → PowerShell MediaPlayer（隐藏启动）', available: true, detail: version };
    }
    return {
      platform: 'win32',
      backend: 'powershell MediaPlayer（会闪窗）',
      available: true,
      detail: `${version}；wscript 或启动器文件缺失，已回落到 cmd 中转`,
    };
  }
  if (PLATFORM === 'darwin') {
    const ok = spawnSync('command', ['-v', 'afplay'], { shell: true, stdio: 'ignore' }).status === 0;
    return { platform: 'darwin', backend: 'afplay', available: ok, detail: ok ? 'afplay found' : 'afplay missing' };
  }
  const found = whichAll(['paplay', 'ffplay', 'mpv']);
  return {
    platform: PLATFORM,
    backend: found[0] ?? 'none',
    available: found.length > 0,
    detail: found.length ? `found: ${found.join(', ')}` : 'install paplay, ffplay or mpv',
  };
}

/** Fire-and-forget playback. Returns true when a player was launched. */
export function playSound(file, options = {}) {
  const volume = clampVolume(options.volume);
  const inline = options.mode === 'inline';
  const spec = buildCommand(file, volume, inline);

  if (!spec) {
    logError(`no audio backend available (platform=${PLATFORM}, file=${file})`);
    return false;
  }

  const baseOptions = { stdio: 'ignore', windowsHide: true };
  const spawnOptions = spec.type === 'cmdline' ? { ...baseOptions, shell: true } : baseOptions;
  const [command, args] = spec.type === 'cmdline' ? [spec.line, []] : [spec.command, spec.args];

  try {
    if (inline) {
      const child = spawnSync(command, args, { ...spawnOptions, timeout: 15000 });
      if (child.error || child.status !== 0) {
        logError(`inline playback failed: ${child.error?.message ?? `exit ${child.status}`} (${file})`);
        return false;
      }
      return true;
    }

    const child = spawn(command, args, { ...spawnOptions, detached: true });
    child.on('error', (error) => logError(`spawn failed: ${error.message} (${file})`));
    child.unref();
    return true;
  } catch (error) {
    logError(`playback threw: ${error.message} (${file})`);
    return false;
  }
}
