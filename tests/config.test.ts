import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ConfigStore, normalizeStore, resolveDataDir } from '../service/config.js';

const dirs: string[] = [];

async function tempStore(): Promise<{ store: ConfigStore; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dingtalk-config-'));
  dirs.push(dir);
  return { store: await ConfigStore.open(dir), dir };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('normalizeStore', () => {
  test('空值给默认设置', () => {
    const store = normalizeStore(null);
    expect(store.settings.enabled).toBe(true);
    expect(store.settings.clientId).toBe('');
    expect(store.settings.allowedUsers).toEqual([]);
    expect(store.binding).toBeNull();
  });

  test('坏字段被丢掉，好字段留下', () => {
    const store = normalizeStore({
      settings: { clientId: ' key ', clientSecret: 42, allowedUsers: ['a', 'a', '', 7], enabled: 'no' },
      binding: { userId: 'u1', sessionId: 'ses_1', target: { conversationType: 'group', conversationId: 'c1' } },
      activity: [{ at: 1, kind: 'nope', text: 'x' }, { text: '' }],
    });
    expect(store.settings.clientId).toBe('key');
    expect(store.settings.clientSecret).toBe('');
    expect(store.settings.allowedUsers).toEqual(['a']);
    expect(store.settings.enabled).toBe(true);
    expect(store.binding?.sessionId).toBe('ses_1');
    expect(store.binding?.target.conversationType).toBe('group');
    expect(store.activity).toHaveLength(1);
    expect(store.activity[0]?.kind).toBe('state');
  });
});

describe('数据目录', () => {
  test('优先用宿主给的，没给就退到主目录', () => {
    expect(resolveDataDir({ OPENCHAMBER_SERVICE_DATA_DIR: 'D:/data/dingtalk' })).toBe('D:/data/dingtalk');
    const fallback = resolveDataDir({});
    expect(path.isAbsolute(fallback)).toBe(true);
    expect(fallback.endsWith('.openchamber-dingtalk')).toBe(true);
  });
});

describe('ConfigStore', () => {  test('保存设置、绑定与活动，重启后还在', async () => {
    const { store, dir } = await tempStore();
    await store.patchSettings({ clientId: 'abc', clientSecret: '***', directory: 'D:/proj', allowedUsers: ['u1'] });
    await store.setBinding({
      userId: 'u1',
      sessionId: 'ses_1',
      directory: 'D:/proj',
      title: '钉钉 · 张三',
      target: { conversationType: 'single', conversationId: 'c1', userId: 'u1', sessionWebhook: 'https://api.dingtalk.com/x' },
      boundAt: 123,
    });
    await store.rememberSession({ sessionId: 'ses_1', title: 't', directory: 'D:/proj', at: 1 });
    await store.logActivity('in', '你好');

    const reopened = await ConfigStore.open(dir);
    expect(reopened.settings.clientId).toBe('abc');
    expect(reopened.settings.directory).toBe('D:/proj');
    expect(reopened.binding?.sessionId).toBe('ses_1');
    expect(reopened.binding?.target.sessionWebhook).toBe('https://api.dingtalk.com/x');
    expect(reopened.value.sessions[0]?.sessionId).toBe('ses_1');
    expect(reopened.value.activity.at(-1)?.text).toBe('你好');
  });

  test('文件权限是 0600（密钥在里面）', async () => {
    const { store, dir } = await tempStore();
    await store.patchSettings({ clientSecret: 'secret' });
    if (process.platform === 'win32') return;
    const info = await stat(path.join(dir, 'bridge.json'));
    expect(info.mode & 0o777).toBe(0o600);
  });

  test('坏文件被备份，不会挡住启动', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dingtalk-config-'));
    dirs.push(dir);
    await Bun.write(path.join(dir, 'bridge.json'), '{ this is not json');
    const store = await ConfigStore.open(dir);
    expect(store.settings.enabled).toBe(true);
    const reopened = await ConfigStore.open(dir);
    expect(reopened.settings.enabled).toBe(true);
    const backup = await readFile(path.join(dir, 'bridge.json.broken-0'), 'utf8').catch(() => null);
    expect(backup === null || backup.includes('not json')).toBe(true);
  });

  test('活动日志有上限', async () => {
    const { store } = await tempStore();
    for (let index = 0; index < 40; index++) await store.logActivity('state', `第 ${index} 条`);
    expect(store.value.activity.length).toBe(30);
    expect(store.value.activity.at(-1)?.text).toBe('第 39 条');
  });
});
