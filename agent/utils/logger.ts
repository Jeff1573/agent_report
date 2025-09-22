/**
 * 日志工具（无第三方依赖）
 * 功能：
 * - 控制台彩色输出（区分 DEBUG/INFO/WARN/ERROR）
 * - 写入日志文件（按天滚动，JSON Lines）
 * - 运行时可由环境变量控制：LOG_LEVEL、LOG_DIR、LOG_COLOR
 * 约束：
 * - 文件写入采用 appendFile 队列，保证顺序；极端高并发下建议替换为专用日志库
 * - JSON Lines 采取尽力序列化策略，循环引用对象以 util.inspect 兜底
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as util from 'node:util';
import { LOG_COLOR, LOG_DIR, LOG_LEVEL } from '../config/env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  gray: '\u001b[90m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
} as const;

/** LOG_COLOR: auto(默认)/true/false */
function shouldColor(): boolean {
  const pref = String(LOG_COLOR ?? 'auto').toLowerCase();
  if (pref === 'true') return true;
  if (pref === 'false') return false;
  // auto：TTY 才启用颜色
  return Boolean(process.stdout.isTTY);
}

function parseLevel(lvl: unknown): LogLevel {
  const v = String(lvl ?? LOG_LEVEL ?? 'info').toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  return 'info';
}

function levelEnabled(current: LogLevel, target: LogLevel): boolean {
  return LEVEL_ORDER[target] >= LEVEL_ORDER[current];
}

function colorize(level: LogLevel, text: string, enable: boolean): string {
  if (!enable) return text;
  const c = level === 'error'
    ? ANSI.red
    : level === 'warn'
      ? ANSI.yellow
      : level === 'debug'
        ? ANSI.cyan
        : ANSI.green;
  return `${c}${text}${ANSI.reset}`;
}

function ts(): string {
  return new Date().toISOString();
}

function currentLogFile(dir: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(dir, `agent-${y}-${m}-${day}.log`);
}

function ensureDirSync(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeToJSON(v: unknown): unknown {
  try {
    // 原生类型/可序列化对象直接返回
    JSON.stringify(v);
    return v;
  } catch {
    // 循环引用等情况，使用 util.inspect 字符串兜底
    return util.inspect(v, { depth: 5, colors: false });
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      return util.inspect(a, { depth: 5, colors: shouldColor() });
    })
    .join(' ');
}

interface JsonLogRecord {
  time: string;
  level: LogLevel;
  msg?: string;
  args?: unknown[];
  pid: number;
  hostname: string;
}

class FileAppender {
  private dir: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
    ensureDirSync(dir);
  }

  append(line: string): void {
    const file = currentLogFile(this.dir);
    this.chain = this.chain
      .then(() => fsp.appendFile(file, line, { encoding: 'utf8' }))
      .catch((e) => {
        // 写文件失败不抛出到业务，打印到 stderr
        const msg = `[logger] 写入失败: ${e?.message ?? e}`;
        // eslint-disable-next-line no-console
        console.error(msg);
      });
  }
}

interface LoggerOptions {
  level?: LogLevel;
  dir?: string;
  color?: boolean;
  context?: Record<string, unknown>;
}

/**
 * 轻量日志器：控制台 + 文件
 */
class Logger {
  private level: LogLevel;
  private color: boolean;
  private appender: FileAppender;
  private context: Record<string, unknown>;

  constructor(opts: LoggerOptions = {}) {
    const level = parseLevel(opts.level ?? LOG_LEVEL);
    const dir = String(opts.dir ?? LOG_DIR ?? path.join(process.cwd(), 'logs'));
    const color = opts.color ?? shouldColor();
    this.level = level;
    this.color = Boolean(color);
    this.appender = new FileAppender(dir);
    this.context = { ...(opts.context ?? {}) };
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ level: this.level, color: this.color, dir: undefined, context: { ...this.context, ...extra } });
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (!levelEnabled(this.level, level)) return;

    const time = ts();
    const tag = level.toUpperCase();
    const head = `${time} [${tag}]`;
    const ctx = Object.keys(this.context).length > 0 ? ` ${ANSI.dim}${JSON.stringify(this.context)}${ANSI.reset}` : '';
    const text = formatConsoleArgs(args);

    const line = `${head}${ctx} ${text}`;
    const colored = colorize(level, line, this.color);

    // 控制台输出
    // eslint-disable-next-line no-console
    if (level === 'error') console.error(colored);
    else if (level === 'warn') console.warn(colored);
    else console.log(colored);

    // 文件输出（JSON Lines）
    const record: JsonLogRecord = {
      time,
      level,
      msg: typeof args[0] === 'string' ? (args[0] as string) : undefined,
      args: args.map(safeToJSON),
      pid: process.pid,
      hostname: os.hostname(),
    };
    const json = JSON.stringify({ ...record, ...(this.context ? { context: this.context } : {}) });
    this.appender.append(json + os.EOL);
  }

  /** INFO 级别 */
  info(...args: unknown[]): void {
    this.write('info', args);
  }
  /** WARN 级别 */
  warn(...args: unknown[]): void {
    this.write('warn', args);
  }
  /** ERROR 级别（Error 对象将输出堆栈） */
  error(...args: unknown[]): void {
    this.write('error', args);
  }
  /** DEBUG 级别 */
  debug(...args: unknown[]): void {
    this.write('debug', args);
  }
}

// 单例导出，保持与旧 API 兼容
export const logger = new Logger();

/** 兼容旧命名导出 */
export const logInfo = (...args: unknown[]) => logger.info(...args);
export const logError = (...args: unknown[]) => logger.error(...args);
export const logWarn = (...args: unknown[]) => logger.warn(...args);
export const logDebug = (...args: unknown[]) => logger.debug(...args);

/**
 * 工厂方法：创建带上下文的子 logger（例如请求 ID、模块名）。
 * @example
 * const reqLogger = createLogger({ requestId: 'abc' })
 * reqLogger.info('收到请求')
 */
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}
