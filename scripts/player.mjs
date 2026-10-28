import { spawn, spawnSync } from 'node:child_process';
import { logError } from './config.mjs';

const PLATFORM = process.platform;

function clampVolume(volume) {
  const n = Number(volume);
  if (!Number.isFinite(n)) return 0.7;
  return Math.min(1, Math.max(0, n));
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsCommand(file, volume) {
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
  // Measured on Windows: bare `detached` gets reaped, `detached + shell: true` survives.
  return { type: 'cmdline', line };
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

export function buildCommand(file, volume) {
  if (PLATFORM === 'win32') return windowsCommand(file, volume);
  if (PLATFORM === 'darwin') return macCommand(file, volume);
  return linuxCommand(file, volume);
}

export function detectPlayer() {
  if (PLATFORM === 'win32') {
    const probe = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    const ok = probe.status === 0;
    return {
      platform: 'win32',
      backend: 'powershell MediaPlayer',
      available: ok,
      detail: ok ? `PowerShell ${String(probe.stdout).trim()}` : String(probe.stderr ?? '').trim() || 'PowerShell not found',
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
  const spec = buildCommand(file, volume);

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
