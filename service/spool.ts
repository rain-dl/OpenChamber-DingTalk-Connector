/**
 * 与 OpenCode 插件共享的投递目录。
 *
 * 插件（跑在 OpenCode 里）没法拿到服务的端口和令牌，所以两边约好一个固定目录：
 *
 *   <root>/status.json          服务写的状态（是否配置、是否已绑定）
 *   <root>/outbox/<id>.json     插件写的待发消息
 *   <root>/results/<id>.json    服务写的投递结果
 *
 * 默认 root 是 `~/.openchamber-dingtalk`，可用 `OPENCHAMBER_DINGTALK_HOME` 覆盖（测试也用它）。
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SPOOL_HOME_ENV = 'OPENCHAMBER_DINGTALK_HOME';

export type BridgeStatusFile = {
  v: 1;
  at: number;
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  bound: boolean;
  userId?: string;
  sessionId?: string;
};

export type OutboxJob = {
  v: 1;
  id: string;
  at: number;
  text?: string;
  files?: string[];
};

export type OutboxResult = {
  at: number;
  ok: boolean;
  error?: string;
};

export type OutboxEntry = { file: string; job: OutboxJob };

const RESULT_KEEP = 50;

export function spoolRoot(env: NodeJS.ProcessEnv = process.env): string {
  const custom = (env[SPOOL_HOME_ENV] ?? '').trim();
  if (custom) return custom;
  return path.join(os.homedir(), '.openchamber-dingtalk');
}

export function statusFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(spoolRoot(env), 'status.json');
}

export function outboxDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(spoolRoot(env), 'outbox');
}

export function resultsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(spoolRoot(env), 'results');
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

export async function writeBridgeStatus(status: BridgeStatusFile, env?: NodeJS.ProcessEnv): Promise<void> {
  const file = statusFile(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, status);
}

export async function readBridgeStatus(env?: NodeJS.ProcessEnv): Promise<BridgeStatusFile | null> {
  try {
    const parsed = JSON.parse(await readFile(statusFile(env), 'utf8')) as Partial<BridgeStatusFile>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      v: 1,
      at: Number(parsed.at) || 0,
      configured: !!parsed.configured,
      enabled: !!parsed.enabled,
      connected: !!parsed.connected,
      bound: !!parsed.bound,
      ...(typeof parsed.userId === 'string' ? { userId: parsed.userId } : {}),
      ...(typeof parsed.sessionId === 'string' ? { sessionId: parsed.sessionId } : {}),
    };
  } catch {
    return null;
  }
}

/** 插件写一条待发任务；返回任务 id。 */
export async function enqueueOutboxJob(
  input: { text?: string; files?: string[] },
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const dir = outboxDir(env);
  await mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const job: OutboxJob = {
    v: 1,
    id,
    at: Date.now(),
    ...(input.text ? { text: input.text } : {}),
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
  };
  await writeJsonAtomic(path.join(dir, `${id}.json`), job);
  return id;
}

/** 服务侧：按时间顺序取出所有待发任务（坏的直接挪走，别卡住队列）。 */
export async function drainOutbox(env?: NodeJS.ProcessEnv): Promise<OutboxEntry[]> {
  const dir = outboxDir(env);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: OutboxEntry[] = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<OutboxJob>;
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') throw new Error('任务格式不对');
      entries.push({
        file,
        job: {
          v: 1,
          id: raw.id,
          at: Number(raw.at) || 0,
          ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
          ...(Array.isArray(raw.files) ? { files: raw.files.filter((item): item is string => typeof item === 'string') } : {}),
        },
      });
    } catch {
      await rename(file, `${file}.bad`).catch(() => undefined);
    }
  }
  return entries;
}

export async function removeOutboxJob(file: string): Promise<void> {
  await rm(file, { force: true });
}

/** 服务侧：把结果留给插件，顺手清理旧结果。 */
export async function writeOutboxResult(
  id: string,
  result: OutboxResult,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const dir = resultsDir(env);
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(path.join(dir, `${id}.json`), result);
  try {
    const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
    for (const name of names.slice(0, Math.max(0, names.length - RESULT_KEEP))) {
      await rm(path.join(dir, name), { force: true }).catch(() => undefined);
    }
  } catch {
    // 清理失败不影响投递。
  }
}

export async function readOutboxResult(id: string, env?: NodeJS.ProcessEnv): Promise<OutboxResult | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(resultsDir(env), `${id}.json`), 'utf8')) as OutboxResult;
    return { at: Number(parsed.at) || 0, ok: !!parsed.ok, ...(parsed.error ? { error: String(parsed.error) } : {}) };
  } catch {
    return null;
  }
}
