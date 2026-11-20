/**
 * OpenCode 插件：`send_dingtalk` 工具注册与投递流程。
 *
 * 插件通过共享目录和服务对话，所以这里直接按服务的方式读写那三个文件。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import plugin from '../plugin/index.js';
import {
  drainOutbox,
  outboxDir,
  writeBridgeStatus,
  writeOutboxResult,
} from '../service/spool.js';

const dirs: string[] = [];

type Tool = {
  name: string;
  description: string;
  options?: { codemode: boolean };
  input: { properties?: Record<string, unknown> };
  execute: (args: Record<string, unknown>) => Promise<{ content: string }>;
};

async function registerTools(): Promise<Tool[]> {
  const tools: Tool[] = [];
  await (plugin as unknown as {
    setup: (ctx: { tool: { transform: (edit: (list: { add: (tool: Tool) => void }) => void) => Promise<void> } }) => Promise<void>;
  }).setup({
    tool: {
      transform: async (edit) => {
        edit({ add: (tool) => tools.push(tool) });
      },
    },
  });
  return tools;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dingtalk-plugin-'));
  dirs.push(home);
  process.env.OPENCHAMBER_DINGTALK_HOME = home;
});

afterEach(async () => {
  delete process.env.OPENCHAMBER_DINGTALK_HOME;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('send_dingtalk 工具', () => {
  test('插件形状与工具描述符合 OpenCode 2 的要求', async () => {
    expect((plugin as { id?: string }).id).toBe('dingtalk-bridge');
    const [tool] = await registerTools();
    expect(tool?.name).toBe('send_dingtalk');
    expect(tool?.options).toEqual({ codemode: false });
    expect(tool?.description).toContain('钉钉');
    expect(Object.keys(tool?.input.properties ?? {})).toEqual(['text', 'files']);
  });

  test('服务没在运行时明确报错', async () => {
    const [tool] = await registerTools();
    await expect(tool!.execute({ text: '你好' })).rejects.toThrow('没在运行');
  });

  test('状态过期也当作没在运行', async () => {
    await writeBridgeStatus({
      v: 1,
      at: Date.now() - 60_000,
      configured: true,
      enabled: true,
      connected: true,
      bound: true,
    });
    const [tool] = await registerTools();
    await expect(tool!.execute({ text: '你好' })).rejects.toThrow('没在运行');
  });

  test('没配置或没绑定时给出去哪里的提示', async () => {
    await writeBridgeStatus({ v: 1, at: Date.now(), configured: false, enabled: true, connected: false, bound: false });
    const [tool] = await registerTools();
    await expect(tool!.execute({ text: '你好' })).rejects.toThrow('AppKey');

    await writeBridgeStatus({ v: 1, at: Date.now(), configured: true, enabled: true, connected: true, bound: false });
    await expect(tool!.execute({ text: '你好' })).rejects.toThrow('绑定');
  });

  test('空参数被拒绝', async () => {
    await writeBridgeStatus({ v: 1, at: Date.now(), configured: true, enabled: true, connected: true, bound: true });
    const [tool] = await registerTools();
    await expect(tool!.execute({})).rejects.toThrow('至少给一个');
    await expect(tool!.execute({ files: ['a', 'b', 'c', 'd', 'e', 'f'] })).rejects.toThrow('最多发 5 个');
  });

  test('写进 outbox，等到成功的回执后报告发了什么', async () => {
    await writeBridgeStatus({ v: 1, at: Date.now(), configured: true, enabled: true, connected: true, bound: true });
    const [tool] = await registerTools();

    const pending = tool!.execute({ text: '任务完成', files: ['D:/out/report.md'] });
    await waitFor(async () => (await readdir(outboxDir()).catch(() => [])).some((name) => name.endsWith('.json')));
    const [entry] = await drainOutbox();
    expect(entry?.job.text).toBe('任务完成');
    expect(entry?.job.files).toEqual(['D:/out/report.md']);
    expect(JSON.parse(await readFile(entry!.file, 'utf8'))).toMatchObject({ v: 1, text: '任务完成' });

    await writeOutboxResult(entry!.job.id, { at: Date.now(), ok: true });
    const answer = await pending;
    expect(answer.content).toContain('已发送到钉钉');
    expect(answer.content).toContain('report.md');
  });

  test('失败回执变成工具错误', async () => {
    await writeBridgeStatus({ v: 1, at: Date.now(), configured: true, enabled: true, connected: true, bound: true });
    const [tool] = await registerTools();

    const pending = tool!.execute({ text: '你好' });
    await waitFor(async () => (await readdir(outboxDir()).catch(() => [])).some((name) => name.endsWith('.json')));
    const [entry] = await drainOutbox();
    await writeOutboxResult(entry!.job.id, { at: Date.now(), ok: false, error: '钉钉服务请求失败' });
    await expect(pending).rejects.toThrow('钉钉发送失败：钉钉服务请求失败');
  });

  test('坏的任务文件不会让插件崩溃', async () => {
    await writeFile(path.join(outboxDir(), 'x.json'), 'nope', 'utf8').catch(() => undefined);
    expect(await drainOutbox()).toEqual([]);
  });
});
