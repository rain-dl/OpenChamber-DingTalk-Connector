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

/** 宿主 OpenCode 2.3.2 的真实形状：项目用 canonical，会话包一层 data。 */
const project = (id: string, canonical: string) => ({ id, canonical, vcs: 'git' });
const session = (overrides: Record<string, unknown> = {}) => ({
  id: 'ses_1',
  title: '会话',
  outcome: 'succeeded',
  time: { created: 1, updated: 9 },
  location: { directory: 'D:/a' },
  ...overrides,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenCode 只读访问', () => {
  test('没有环境变量时返回 null（没批准角色）', () => {
    expect(createOpenCodeReader({})).toBeNull();
    expect(createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:1' })).toBeNull();
  });

  test('项目取 canonical 字段并排序', async () => {
    installFetch([{
      path: '/api/project',
      body: [project('p1', 'D:\\b'), project('p2', 'D:\\a')],
    }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    expect(await reader.listProjects()).toEqual([
      { id: 'p2', worktree: 'D:\\a' },
      { id: 'p1', worktree: 'D:\\b' },
    ]);
  });

  test('项目接口为空时用会话目录兜底，并滤掉快捷聊天目录', async () => {
    installFetch([
      { path: '/api/project', body: [] },
      {
        path: '/api/session',
        body: {
          data: [
            session({ id: 's1', location: { directory: 'D:/proj-a' } }),
            session({ id: 's2', location: { directory: 'D:/proj-a' } }),
            session({ id: 's3', location: { directory: 'C:/Users/me/.config/openchamber/chats/2026-11-20/session-x' } }),
            session({ id: 's4', location: { directory: '/' } }),
          ],
          cursor: null,
        },
      },
    ]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    expect(await reader.listProjects()).toEqual([{ id: 'D:/proj-a', worktree: 'D:/proj-a' }]);
  });

  test('会话：data 数组、location.directory、归档与子会话被排除', async () => {
    installFetch([{
      path: '/api/session',
      body: {
        data: [
          session({ id: 's1', title: '新的', time: { updated: 9 } }),
          session({ id: 's2', title: '旧的', time: { updated: 1 } }),
          session({ id: 's3', time: { updated: 10, archived: 10 } }),
          session({ id: 's4', parentID: 's1', time: { updated: 11 } }),
          session({ id: 's5', title: undefined, time: { updated: 2 } }),
        ],
        cursor: null,
      },
    }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    const sessions = await reader.listSessions();
    expect(sessions.map((item) => item.id)).toEqual(['s1', 's5', 's2']);
    expect(sessions[1]?.title).toBe('未命名会话');
    expect(sessions[0]?.directory).toBe('D:/a');
    expect(sessions[0]?.outcome).toBe('succeeded');
  });

  test('进行中：active 的 id 表 + 会话列表补齐标题', async () => {
    const calls = installFetch([
      { path: '/api/session/active', body: { data: { ses_1: { type: 'running' }, ses_9: { type: 'running' } } } },
      {
        path: '/api/session',
        body: { data: [session({ id: 'ses_1', title: '跑着的' }), session({ id: 'ses_2', title: '闲着的' })] },
      },
    ]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    const running = await reader.listSessions({ activeOnly: true });
    expect(running.map((item) => item.id)).toEqual(['ses_1']);
    expect(running[0]?.title).toBe('跑着的');
    expect(calls).toEqual(['GET /api/session/active', 'GET /api/session']);
  });

  test('没有正在运行的会话时不请求会话列表', async () => {
    const calls = installFetch([{ path: '/api/session/active', body: { data: {} } }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    expect(await reader.listSessions({ activeOnly: true })).toEqual([]);
    expect(calls).toEqual(['GET /api/session/active']);
  });

  test('按目录过滤', async () => {
    installFetch([{
      path: '/api/session',
      body: {
        data: [
          session({ id: 's1', location: { directory: 'D:/a' } }),
          session({ id: 's2', location: { directory: 'D:/b' } }),
        ],
      },
    }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    expect((await reader.listSessions({ directory: 'D:/b' })).map((item) => item.id)).toEqual(['s2']);
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

  test('只请求列出的读接口', async () => {
    const calls = installFetch([{ path: '/api/project', body: [project('p1', 'D:/a')] }]);
    const reader = createOpenCodeReader({ OPENCHAMBER_OPENCODE_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: 't' })!;
    await reader.listProjects();
    expect(calls).toEqual(['GET /api/project']);
  });
});
