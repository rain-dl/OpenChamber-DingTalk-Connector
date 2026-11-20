import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hostSettingsFile, isWithinProject, readHostProjects } from '../service/host-projects.js';

const dirs: string[] = [];
const original = process.env.OPENCHAMBER_CONFIG_DIR;

afterEach(async () => {
  if (original === undefined) delete process.env.OPENCHAMBER_CONFIG_DIR;
  else process.env.OPENCHAMBER_CONFIG_DIR = original;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function configDir(settings?: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'openchamber-config-'));
  dirs.push(dir);
  if (settings !== undefined) {
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  }
  return dir;
}

describe('OpenChamber 已打开的项目', () => {
  test('从 settings.json 读出 path 与 label', async () => {
    const dir = await configDir({
      projects: [
        { id: 'p1', path: 'D:\\b', label: 'B' },
        { id: 'p2', path: 'D:\\a', label: 'A', color: '#fff' },
      ],
    });
    expect(hostSettingsFile({ OPENCHAMBER_CONFIG_DIR: dir })).toBe(path.join(dir, 'settings.json'));
    expect(await readHostProjects({ OPENCHAMBER_CONFIG_DIR: dir })).toEqual([
      { id: 'p1', name: 'B', directory: 'D:\\b' },
      { id: 'p2', name: 'A', directory: 'D:\\a' },
    ]);
  });

  test('没有 label 时用路径当名字，坏项被丢掉', async () => {
    const dir = await configDir({
      projects: [{ id: 'p1', path: 'D:/a' }, { id: 'p2' }, null, 'x', { path: '  ' }],
    });
    expect(await readHostProjects({ OPENCHAMBER_CONFIG_DIR: dir })).toEqual([
      { id: 'p1', name: 'D:/a', directory: 'D:/a' },
    ]);
  });

  test('配置文件缺失或损坏时返回空', async () => {
    const empty = await configDir();
    expect(await readHostProjects({ OPENCHAMBER_CONFIG_DIR: empty })).toEqual([]);

    const broken = await configDir();
    await writeFile(path.join(broken, 'settings.json'), '{nope', 'utf8');
    expect(await readHostProjects({ OPENCHAMBER_CONFIG_DIR: broken })).toEqual([]);
  });

  test('默认路径在用户主目录的 .config/openchamber 下', () => {
    expect(hostSettingsFile({})).toBe(path.join(os.homedir(), '.config', 'openchamber', 'settings.json'));
  });
});

describe('项目路径匹配', () => {
  test('项目根与子目录算同一个项目，分隔符和大小写都归一', () => {
    expect(isWithinProject('D:\\proj', 'D:/proj')).toBe(true);
    expect(isWithinProject('d:/PROJ/', 'D:\\proj')).toBe(true);
    expect(isWithinProject('D:/proj/packages/app', 'D:/proj')).toBe(true);
    expect(isWithinProject('D:\\proj\\packages\\app', 'D:\\proj')).toBe(true);
  });

  test('相邻但不同名的目录不算', () => {
    expect(isWithinProject('D:/proj2', 'D:/proj')).toBe(false);
    expect(isWithinProject('D:/proj-other/app', 'D:/proj')).toBe(false);
    expect(isWithinProject('', 'D:/proj')).toBe(false);
    expect(isWithinProject('D:/proj', '')).toBe(false);
  });

  test('快捷聊天目录不落在项目里', () => {
    expect(isWithinProject('C:/Users/me/.config/openchamber/chats/2026-11-20/session-1', 'C:/Users/me')).toBe(true);
    // 但如果用户没把主目录当项目，它自然不匹配
    expect(isWithinProject('C:/Users/me/.config/openchamber/chats/2026-11-20/session-1', 'D:/proj')).toBe(false);
  });
});
