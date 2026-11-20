import { afterEach, describe, expect, test } from 'bun:test';

import { createOpenCodeReader } from '../service/opencode.js';

const originalFetch = globalThis.fetch;

type Route = { path: string; body: unknown; status?: number };

function installFetch(routes: Route[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const answer = routes.find((route) => route.path === url.pathname);
    if (!answer) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenCode 只读访问', () => {
  test('没有环境变量时返回 null（没批准角色）', () => {
    expect(createOpenCodeReader({})).toBeNull();
    expect(createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:1' })).toBeNull();
  });

  test('列出项目', async () => {
    installFetch([{ path: '/api/project', body: [{ id: 'p1', worktree: 'D:/b' }, { id: 'p2', worktree: 'D:/a' }] }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    expect(await reader.listProjects()).toEqual([
      { id: 'p2', worktree: 'D:/a' },
      { id: 'p1', worktree: 'D:/b' },
    ]);
  });

  test('列出会话：按更新时间倒序、去掉子会话、可按目录过滤', async () => {
    installFetch([{
      path: '/api/session',
      body: [
        { id: 's1', title: '旧的', directory: 'D:/a', time: { updated: 1 } },
        { id: 's2', title: '新的', directory: 'D:/b', time: { updated: 9 } },
        { id: 's3', title: '子会话', parentID: 's2', directory: 'D:/b', time: { updated: 10 } },
        { id: 's4', directory: 'D:/a' },
      ],
    }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    const all = await reader.listSessions();
    expect(all.map((session) => session.id)).toEqual(['s2', 's1', 's4']);
    expect(all[2]?.title).toBe('未命名会话');

    const scoped = await reader.listSessions({ directory: 'D:/a' });
    expect(scoped.map((session) => session.id)).toEqual(['s1', 's4']);
  });

  test('把消息整理成轮次：用户提问 + 助手最终文字', async () => {
    installFetch([{
      path: '/api/session/s1/message',
      body: [
        { info: { role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: '第一问' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: '中间想法' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: '第一答' }, { type: 'tool' }] },
        { info: { role: 'user', time: { created: 2 } }, parts: [{ type: 'text', text: '第二问' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: '第二答' }] },
      ],
    }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    expect(await reader.listTurns('s1')).toEqual([
      { user: '第一问', reply: '第一答', at: 1 },
      { user: '第二问', reply: '第二答', at: 2 },
    ]);
  });

  test('HTTP 失败带状态码，方便命令层说清楚', async () => {
    installFetch([{ path: '/api/session', body: {}, status: 403 }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    await expect(reader.listSessions()).rejects.toThrow('OpenCode 返回 403');
  });

  test('带 bearer 且只请求列出的读接口', async () => {
    const routes: Route[] = [{ path: '/api/project', body: [] }];
    const calls = installFetch(routes);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    await reader.listProjects();
    expect(calls).toEqual(['GET /api/project']);
  });
});
