/**
 * OpenChamber 自己“已打开的项目”。
 *
 * 访客契约里没有项目列表接口（`/api/project` 是 OpenCode 的项目注册，不是侧边栏里
 * 用户打开的那些），而应用把这份列表存在配置目录的 `settings.json` 里：
 *
 *   { "projects": [ { id, path, label, … } ] }
 *
 * 这里只读、只用于 `/ws list`；读不到就返回空，由调用方退回 OpenCode 的列表。
 * 配置目录默认 `~/.config/openchamber`（Windows 也在用户主目录下），
 * 可用 `OPENCHAMBER_CONFIG_DIR` 覆盖。
 */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type HostProject = { id: string; name: string; directory: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hostSettingsFile(env: NodeJS.ProcessEnv = process.env): string {
  const custom = text(env.OPENCHAMBER_CONFIG_DIR);
  if (custom) return path.join(custom, 'settings.json');
  return path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
}

export async function readHostProjects(env: NodeJS.ProcessEnv = process.env): Promise<HostProject[]> {
  try {
    const parsed = JSON.parse(await readFile(hostSettingsFile(env), 'utf8')) as { projects?: unknown };
    const list = Array.isArray(parsed.projects) ? parsed.projects : [];
    return list
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => item !== null && !!text(item.path))
      .map((item) => ({
        id: text(item.id) || text(item.path),
        name: text(item.label) || text(item.path),
        directory: text(item.path),
      }));
  } catch {
    return [];
  }
}
