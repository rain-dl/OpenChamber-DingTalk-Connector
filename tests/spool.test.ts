import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  drainOutbox,
  enqueueOutboxJob,
  outboxDir,
  readBridgeStatus,
  readOutboxResult,
  removeOutboxJob,
  resultsDir,
  spoolRoot,
  statusFile,
  writeBridgeStatus,
  writeOutboxResult,
} from '../service/spool.js';

const dirs: string[] = [];
let home = '';

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'dingtalk-spool-'));
  dirs.push(home);
  process.env.OPENCHAMBER_DINGTALK_HOME = home;
});

afterEach(async () => {
  delete process.env.OPENCHAMBER_DINGTALK_HOME;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('共享目录', () => {
  test('路径都在根目录下，可用环境变量覆盖', () => {
    expect(spoolRoot()).toBe(home);
    expect(statusFile()).toBe(path.join(home, 'status.json'));
    expect(outboxDir()).toBe(path.join(home, 'outbox'));
    expect(resultsDir()).toBe(path.join(home, 'results'));
    expect(spoolRoot({})).toContain('.openchamber-dingtalk');
  });

  test('状态文件读回同样的形状', async () => {
    await writeBridgeStatus({
      v: 1,
      at: 123,
      configured: true,
      enabled: true,
      connected: false,
      bound: true,
      userId: 'u1',
      sessionId: 'ses_1',
    });
    const status = await readBridgeStatus();
    expect(status?.bound).toBe(true);
    expect(status?.userId).toBe('u1');
    expect(status?.at).toBe(123);
    expect(await readBridgeStatus({ OPENCHAMBER_DINGTALK_HOME: path.join(home, 'nope') })).toBeNull();
  });

  test('任务按时间排序取出，坏文件被挪开', async () => {
    const first = await enqueueOutboxJob({ text: '第一条' });
    const second = await enqueueOutboxJob({ files: ['D:/tmp/a.png'] });
    await writeFile(path.join(outboxDir(), 'zzz-broken.json'), '{nope', 'utf8');

    const entries = await drainOutbox();
    expect(entries.map((entry) => entry.job.id)).toEqual([first, second]);
    expect(entries[0]?.job.text).toBe('第一条');
    expect(entries[1]?.job.files).toEqual(['D:/tmp/a.png']);
    const names = await readdir(outboxDir());
    expect(names).toContain('zzz-broken.json.bad');

    await removeOutboxJob(entries[0]!.file);
    expect((await readdir(outboxDir())).filter((name) => name.endsWith('.json'))).toHaveLength(1);
  });

  test('结果文件留给插件读，超过上限的旧结果被清掉', async () => {
    await writeOutboxResult('job-1', { at: 1, ok: true });
    expect(await readOutboxResult('job-1')).toEqual({ at: 1, ok: true });

    await writeOutboxResult('job-2', { at: 2, ok: false, error: '没绑定' });
    expect(await readOutboxResult('job-2')).toEqual({ at: 2, ok: false, error: '没绑定' });
    expect(await readOutboxResult('missing')).toBeNull();

    for (let index = 0; index < 60; index++) {
      await writeOutboxResult(`bulk-${String(index).padStart(3, '0')}`, { at: index, ok: true });
    }
    const names = (await readdir(resultsDir())).filter((name) => name.endsWith('.json'));
    expect(names.length).toBeLessThanOrEqual(50);
  });

  test('空目录不会报错', async () => {
    expect(await drainOutbox()).toEqual([]);
    expect(await readOutboxResult('nope')).toBeNull();
  });
});
