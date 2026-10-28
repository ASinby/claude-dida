#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULTS,
  configPath,
  dataDir,
  isQuietNow,
  logError,
  logPath,
  readConfig,
  setKey,
  updateConfig,
} from './config.mjs';
import {
  DEFAULT_THEME,
  EVENTS,
  PLUGIN_ROOT,
  SOUNDS_DIR,
  effectiveTheme,
  listEvents,
  listThemes,
  resolveSound,
  themeDir,
} from './sounds.mjs';
import { detectPlayer, playSound } from './player.mjs';

const CONFIG_KEYS = new Set([
  'theme',
  'volume',
  'enabled',
  'dedupeMs',
  'playbackMode',
  'subagentStop',
  'quietHours.enabled',
  'quietHours.start',
  'quietHours.end',
  ...EVENTS.map((event) => `events.${event}`),
]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function quietExit(code = 0) {
  process.exit(code);
}

function debounceFile(event) {
  return path.join(dataDir(), `last-${event}.stamp`);
}

function withinDebounce(event, dedupeMs) {
  if (!(dedupeMs > 0)) return false;
  try {
    const stat = fs.statSync(debounceFile(event));
    return Date.now() - stat.mtimeMs < dedupeMs;
  } catch {
    return false;
  }
}

function touchDebounce(event) {
  try {
    fs.writeFileSync(debounceFile(event), String(Date.now()), 'utf8');
  } catch (error) {
    logError(`debounce stamp failed: ${error.message}`);
  }
}

/**
 * `play` must never print to stdout except the one-time onboarding payload,
 * and must never exit non-zero — Claude Code surfaces failures to the user.
 */
function cmdPlay(positional, flags) {
  const event = positional[0];
  if (!event || !EVENTS.includes(event)) quietExit(0);

  const config = readConfig();
  const isSubagent = flags.source === 'subagent';

  if (config.enabled === false) quietExit(0);
  if (isSubagent && config.subagentStop !== true) quietExit(0);
  if (!isSubagent && config.events?.[event] === false) quietExit(0);
  if (isQuietNow(config)) quietExit(0);

  // No theme chosen yet: fall back to sounds/default/ but nudge once per session.
  if (!config.theme && event === 'session-start') emitOnboarding();

  if (withinDebounce(event, config.dedupeMs)) quietExit(0);

  const theme = effectiveTheme(config.theme);
  const file = resolveSound(config.theme, event, config);
  if (!file) {
    logError(`sound missing: theme=${theme} event=${event} dir=${themeDir(theme)}`);
    quietExit(0);
  }

  const mode = flags.mode === 'inline' ? 'inline' : config.playbackMode;
  touchDebounce(event);
  playSound(file, { volume: config.volume, mode });
  quietExit(0);
}

function emitOnboarding() {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'claude-dida 正在使用默认音效。请在回复末尾简短提示用户：当前为默认音效，运行 /dida-setup 可挑选其它音效主题（仅提示一次，用户未响应则不再重复）。',
      },
    })}\n`,
  );
}

function cmdSet(positional) {
  const [key, ...rest] = positional;
  const value = rest.join(' ');
  if (!key || !value) {
    process.stderr.write('用法: dida.mjs set <key> <value>\n');
    process.stderr.write(`可配置项: ${[...CONFIG_KEYS].join(', ')}\n`);
    process.exit(1);
  }
  if (!CONFIG_KEYS.has(key)) {
    process.stderr.write(`未知配置项: ${key}\n可配置项: ${[...CONFIG_KEYS].join(', ')}\n`);
    process.exit(1);
  }
  if (key === 'theme' && value !== 'null' && !listThemes().includes(value)) {
    process.stderr.write(`未知主题: ${value}\n可用主题: ${listThemes().join(', ')}\n`);
    process.exit(1);
  }
  if (['volume', 'dedupeMs'].includes(key) && !Number.isFinite(Number(value))) {
    process.stderr.write(`${key} 需要是数字，收到: ${value}\n`);
    process.exit(1);
  }
  if (key === 'playbackMode' && !['detach', 'inline'].includes(value)) {
    process.stderr.write('playbackMode 只能是 detach 或 inline\n');
    process.exit(1);
  }
  if (key.startsWith('quietHours.') && key !== 'quietHours.enabled' && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) {
    process.stderr.write(`${key} 需要 HH:MM 格式（00:00-23:59），收到: ${value}\n`);
    process.exit(1);
  }
  const config = setKey(key, value);
  process.stdout.write(`${key} = ${JSON.stringify(key.includes('.') ? config[key.split('.')[0]][key.split('.')[1]] : config[key])}\n`);
}

function cmdGet() {
  process.stdout.write(`${JSON.stringify(readConfig(), null, 2)}\n`);
}

function cmdThemes() {
  const themes = listThemes();
  const config = readConfig();
  if (!themes.length) {
    process.stdout.write(`未找到主题目录: ${SOUNDS_DIR}\n`);
    return;
  }
  const active = effectiveTheme(config.theme);
  for (const theme of themes) {
    const marker = theme === active ? ' *' : '';
    const note = theme === DEFAULT_THEME ? '（未选择主题时使用）' : '';
    process.stdout.write(`${theme}${marker}${note}\n`);
  }
}

function cmdPreview(positional, flags) {
  const config = readConfig();
  const mode = flags.mode === 'inline' ? 'inline' : config.playbackMode;
  const themes = listThemes();

  // A lone argument naming an event is an event, not a theme.
  const [first, second] = positional;
  const firstIsEvent = first && EVENTS.includes(first) && !themes.includes(first);
  const theme = firstIsEvent ? effectiveTheme(config.theme) : (first ?? effectiveTheme(config.theme));
  const event = firstIsEvent ? first : second;

  if (!themes.includes(theme)) {
    process.stderr.write(`未知主题: ${theme}\n可用主题: ${themes.join(', ')}\n`);
    process.exit(1);
  }

  const targets = event ? [event] : listEvents();

  if (event && !EVENTS.includes(event)) {
    process.stderr.write(`未知音效: ${event}\n可用音效: ${EVENTS.join(', ')}\n`);
    process.exit(1);
  }

  let failed = 0;
  for (const name of targets) {
    const file = resolveSound(theme, name, config);
    if (!file) {
      process.stderr.write(`缺失音效: ${theme}/${name}.mp3\n`);
      failed += 1;
      continue;
    }
    process.stdout.write(`▶ ${theme}/${name}\n`);
    playSound(file, { volume: config.volume, mode: 'inline' });
  }
  if (failed) process.exit(1);
}

function cmdDoctor() {
  const lines = [];
  const ok = (label, detail = '') => lines.push(`  [ok]   ${label}${detail ? ` — ${detail}` : ''}`);
  const warn = (label, detail = '') => lines.push(`  [warn] ${label}${detail ? ` — ${detail}` : ''}`);
  const bad = (label, detail = '') => lines.push(`  [fail] ${label}${detail ? ` — ${detail}` : ''}`);

  lines.push('claude-dida doctor');
  lines.push('');

  lines.push('运行时');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok('Node', `v${process.versions.node}`);
  else bad('Node 版本过低', `v${process.versions.node}，需要 ≥ 18`);
  ok('插件根目录', PLUGIN_ROOT);

  lines.push('');
  lines.push('配置');
  const config = readConfig();
  const cp = configPath();
  const exists = fs.existsSync(cp);
  if (exists) ok('配置路径', cp);
  else warn('配置尚未创建', cp);
  if (config.theme) ok('主题', config.theme);
  else ok('主题', `未选择，使用默认音效 (${DEFAULT_THEME})`);
  ok('总开关', config.enabled ? 'on' : 'off');
  ok('音量', String(config.volume));
  ok('去抖', `${config.dedupeMs}ms`);
  ok('播放模式', config.playbackMode);
  if (config.quietHours.enabled) ok('静默时段', `${config.quietHours.start} - ${config.quietHours.end}`);
  else ok('静默时段', 'off');
  const disabledEvents = EVENTS.filter((event) => config.events?.[event] === false);
  if (disabledEvents.length) warn('已关闭事件', disabledEvents.join(', '));
  else ok('事件开关', '全部开启');
  ok('子代理结束提示', config.subagentStop ? 'on' : 'off');

  lines.push('');
  lines.push('音效');
  const themes = listThemes();
  if (themes.length) ok('主题目录', `${SOUNDS_DIR} (${themes.length} 套: ${themes.join(', ')})`);
  else bad('主题目录为空', SOUNDS_DIR);

  const checkTheme = effectiveTheme(config.theme);
  const missing = EVENTS.filter((event) => !resolveSound(config.theme, event, config));
  if (missing.length) bad(`主题 ${checkTheme} 缺音效`, missing.join(', '));
  else ok(`主题 ${checkTheme} 音效齐全`, `${EVENTS.length} 个`);

  lines.push('');
  lines.push('播放器');
  const player = detectPlayer();
  if (player.available) ok(player.backend, player.detail);
  else bad(`${player.platform} 无可用播放器`, player.detail);

  lines.push('');
  lines.push('Hook 注册');
  const hooksJson = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');
  if (fs.existsSync(hooksJson)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
      ok('hooks.json', Object.keys(parsed.hooks ?? {}).join(', '));
    } catch (error) {
      bad('hooks.json 解析失败', error.message);
    }
  } else {
    bad('hooks.json 缺失', hooksJson);
  }

  lines.push('');
  lines.push('日志');
  const lp = logPath();
  if (fs.existsSync(lp)) {
    const tail = fs.readFileSync(lp, 'utf8').trim().split('\n').slice(-5);
    warn('最近错误', `${tail.length} 行 (${lp})`);
    for (const line of tail) lines.push(`         ${line}`);
  } else {
    ok('无错误日志', lp);
  }

  lines.push('');
  const problems = lines.filter((line) => line.includes('[fail]') || line.includes('[warn]')).length;
  lines.push(problems ? `结论: ${problems} 项需要关注` : '结论: 一切正常');

  process.stdout.write(`${lines.join('\n')}\n`);
}

function cmdOnOff(enabled) {
  updateConfig({ enabled });
  process.stdout.write(`claude-dida 已${enabled ? '开启' : '关闭'}\n`);
}

function cmdReset() {
  const config = updateConfig(structuredClone(DEFAULTS));
  process.stdout.write(`配置已重置为默认值: ${configPath()}\n`);
}

function usage() {
  process.stdout.write(
    `claude-dida

用法:
  dida.mjs play <event> [--source subagent] [--mode inline]   Hook 调用
  dida.mjs set <key> <value>                                  修改配置
  dida.mjs get                                                输出配置
  dida.mjs themes                                             列出主题
  dida.mjs preview [theme] [event]                            试听
  dida.mjs doctor                                             健康检查
  dida.mjs on | off                                           总开关
  dida.mjs reset                                              重置配置

事件: ${EVENTS.join(', ')}
数据目录: ${dataDir()}
`,
  );
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional.shift();

  switch (command) {
    case 'play':
      return cmdPlay(positional, flags);
    case 'set':
      return cmdSet(positional);
    case 'get':
      return cmdGet();
    case 'themes':
      return cmdThemes();
    case 'preview':
      return cmdPreview(positional, flags);
    case 'doctor':
      return cmdDoctor();
    case 'on':
      return cmdOnOff(true);
    case 'off':
      return cmdOnOff(false);
    case 'reset':
      return cmdReset();
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      return usage();
    default:
      process.stderr.write(`未知命令: ${command}\n\n`);
      usage();
      process.exit(1);
  }
}

try {
  main();
} catch (error) {
  logError(`fatal: ${error?.stack ?? error}`);
  if (process.argv[2] === 'play') process.exit(0);
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exit(1);
}
