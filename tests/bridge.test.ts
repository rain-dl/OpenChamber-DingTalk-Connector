import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GuestSessionEventRequest, ServiceHost } from '@openchamber/sdk';

import { Bridge } from '../service/bridge.js';
import { ConfigStore } from '../service/config.js';
import { DingTalkApiError, type DingTalkApi } from '../service/dingtalk/api.js';
import type { RobotCallback } from '../service/dingtalk/types.js';
import type { OpenCodeReader } from '../service/opencode.js';

const dirs: string[] = [];

type Recorded = { kind: string; [key: string]: unknown };

function fakeApi(recorded: Recorded[], controls: { failTimes: number } = { failTimes: 0 }): DingTalkApi {
  const push = (kind: string, extra: Record<string, unknown> = {}) => recorded.push({ kind, ...extra });
  return {
    sendSessionText: async (options: { text: string }) => {
      if (controls.failTimes > 0) {
        controls.failTimes -= 1;
        // 限流：sendTextMessage 不会回落到机器人接口，正是要测的排队场景。
        throw new DingTalkApiError('send-rejected', '钉钉限流', { status: 429 });
      }
      push('webhook', { text: options.text });
    },
    sendRobotText: async (options: { text: string }) => push('robot', { text: options.text }),
    sendFile: async () => push('file'),
    sendImage: async () => push('image'),
    uploadMedia: async () => 'media',
    resolveDownloadUrl: async () => new URL('https://api.dingtalk.com/x'),
    downloadAttachment: async () => ({ bytes: Buffer.from('x'), contentType: 'image/png' }),
    createAiCard: async () => {
      push('card-create');
      return { cardInstanceId: 'card-1' };
    },
    updateAiCard: async () => push('card-update'),
    finishAiCard: async (options: { text: string }) => push('card-finish', { text: options.text }),
    failAiCard: async (options: { text: string }) => push('card-fail', { text: options.text }),
    addReaction: async () => push('reaction'),
    recallReaction: async () => push('reaction-recall'),
    accessToken: async () => 'token',
    clearAccessToken: () => undefined,
  } as unknown as DingTalkApi;
}

function fakeHost(state: { starts: unknown[]; sends: unknown[]; answers: unknown[] }): ServiceHost {
  return {
    sessions: {
      start: async (input: unknown) => {
        state.starts.push(input);
        const index = state.starts.length;
        return { sessionId: `ses_${index}`, directory: 'D:/proj' };
      },
      send: async (sessionId: string, prompt: string) => {
        state.sends.push({ sessionId, prompt });
        return { sent: true };
      },
      retry: async () => ({ sent: true }),
      status: async () => ({ status: 'idle' as const }),
      lastReply: async () => ({ reply: null }),
      stop: async () => ({ stopped: true }),
      answerPermission: async (sessionId: string, requestId: string, answer: unknown) => {
        state.answers.push({ kind: 'permission', sessionId, requestId, answer });
        return { answered: true as const };
      },
      answerForm: async (sessionId: string, formId: string, values: unknown) => {
        state.answers.push({ kind: 'form', sessionId, formId, values });
        return { answered: true as const };
      },
    },
    setInstructions: async () => ({ saved: true as const }),
    emit: async () => ({ delivered: true as const }),
    readSettings: async () => ({}),
    needsConfiguration: async () => ({ saved: true as const }),
    setMark: async () => ({ saved: true as const }),
  } as unknown as ServiceHost;
}

async function setup(options: {
  withReader?: boolean;
  sessions?: Array<{ id: string; title: string; directory: string; updatedAt: number; outcome?: string }>;
  projects?: string[];
  turns?: Array<{ user: string; reply: string; at: number }>;
  /** 写进 OpenChamber settings.json 的“已打开项目”；`null` 表示没有配置文件。 */
  hostProjects?: Array<{ path: string; label?: string }> | null;
} = {}): Promise<{
  bridge: Bridge;
  store: ConfigStore;
  recorded: Recorded[];
  hostState: { starts: unknown[]; sends: unknown[]; answers: unknown[] };
  controls: { failTimes: number };
  readerCalls: string[];
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dingtalk-bridge-'));
  dirs.push(dir);
  const store = await ConfigStore.open(dir);
  await store.patchSettings({
    clientId: 'app-key',
    clientSecret: 'secret',
    robotCode: 'robot',
    directory: 'D:/proj',
  });
  const recorded: Recorded[] = [];
  const hostState = { starts: [], sends: [], answers: [] };
  const controls = { failTimes: 0 };
  const readerCalls: string[] = [];

  // OpenChamber 的“已打开项目”来自配置目录的 settings.json；测试里指到临时目录。
  const configDir = path.join(dir, 'openchamber-config');
  await mkdir(configDir, { recursive: true });
  const hostProjects = options.hostProjects === null
    ? null
    : (options.hostProjects ?? [{ path: 'D:/proj', label: 'Proj A' }, { path: 'D:/other', label: 'Proj B' }]);
  if (hostProjects) {
    await writeFile(
      path.join(configDir, 'settings.json'),
      JSON.stringify({ projects: hostProjects.map((project, index) => ({ id: `hp${index}`, path: project.path, label: project.label })) }),
      'utf8',
    );
  }
  process.env.OPENCHAMBER_CONFIG_DIR = configDir;

  const baseSessions = options.sessions ?? [
    { id: 'ses_live', title: '正在运行的会话', directory: 'D:/proj', updatedAt: Date.now(), outcome: 'succeeded' },
    { id: 'ses_app_1', title: '应用里开的会话', directory: 'D:/proj', updatedAt: Date.now() - 60_000, outcome: 'succeeded' },
    { id: 'ses_app_2', title: '另一个会话', directory: 'D:/other', updatedAt: Date.now() - 120_000, outcome: 'interrupted' },
  ];
  const reader: OpenCodeReader = {
    listProjects: async () => {
      readerCalls.push('projects');
      return (options.projects ?? ['D:/proj', 'D:/other']).map((worktree, index) => ({ id: `p${index}`, worktree }));
    },
    listSessions: async (filter = {}) => {
      readerCalls.push(filter.activeOnly ? 'sessions:active' : 'sessions');
      const scoped = baseSessions.filter((session) => !filter.directory || session.directory === filter.directory);
      const withOutcome = scoped.map((session) => ({ ...session, outcome: session.outcome ?? 'succeeded' }));
      return filter.activeOnly ? withOutcome.filter((session) => session.id === 'ses_live') : withOutcome;
    },
    listTurns: async () => {
      readerCalls.push('turns');
      return options.turns ?? [
        { user: '第一轮提问', reply: '第一轮回复', at: 1 },
        { user: '第二轮提问', reply: '第二轮回复', at: 2 },
      ];
    },
  };

  const bridge = new Bridge({
    store,
    host: fakeHost(hostState),
    dataDir: dir,
    api: fakeApi(recorded, controls),
    log: () => undefined,
    onStateChange: () => undefined,
    ...(options.withReader === false ? {} : { opencode: reader }),
  });
  return { bridge, store, recorded, hostState, controls, readerCalls };
}

function callback(text: string, overrides: Partial<RobotCallback> = {}): RobotCallback {
  return {
    msgId: `msg_${Math.random().toString(36).slice(2)}`,
    conversationId: 'cid_1',
    conversationType: '1',
    senderId: 'sender-opaque',
    senderStaffId: 'staff_1',
    senderNick: '张三',
    msgtype: 'text',
    text: { content: text },
    sessionWebhook: 'https://api.dingtalk.com/robot/sendBySession?session=1',
    ...overrides,
  };
}

/** 表情回应也会进录制表，只取最后一条真正发出的文字。 */
function lastText(recorded: Recorded[]): string {
  for (let index = recorded.length - 1; index >= 0; index -= 1) {
    const text = recorded[index]?.text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/** 卡片是 fire-and-forget 建起来的，等它落到录制表里。 */
async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function event(
  type: string,
  sessionId: string,
  content: unknown,
  extra: Record<string, unknown> = {},
): GuestSessionEventRequest {
  return {
    v: 1,
    requestId: 'req_1',
    event: {
      id: 'evt_1',
      type,
      at: Date.now(),
      session: { id: sessionId, parentId: null },
      project: { directory: 'D:/proj' },
      linked: [],
      ...extra,
    },
    content,
  } as unknown as GuestSessionEventRequest;
}

afterEach(async () => {
  delete process.env.OPENCHAMBER_CONFIG_DIR;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('入站消息', () => {
  test('第一条消息开新会话，之后走 sessions.send', async () => {
    const { bridge, store, hostState } = await setup();

    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    expect(hostState.starts).toHaveLength(1);
    expect(hostState.starts[0]).toMatchObject({ prompt: '你好', directory: 'D:/proj', title: '钉钉 · 张三' });
    expect(store.binding?.sessionId).toBe('ses_1');
    expect(store.value.ownerUserId).toBe('staff_1');

    bridge.handleInbound(callback('继续'));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([{ sessionId: 'ses_1', prompt: '继续' }]);
  });

  test('没有设置目录时提示去面板设置，不建会话', async () => {
    const { bridge, store, recorded, hostState } = await setup();
    await store.patchSettings({ directory: '' });

    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    expect(hostState.starts).toHaveLength(0);
    expect(recorded.map((item) => item.kind)).toContain('webhook');
    expect(lastText(recorded)).toContain('默认项目目录');
  });

  test('绑定后其他用户被拒绝', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('我也来', { senderStaffId: 'staff_2', senderNick: '李四' }));
    await bridge.whenIdle();

    expect(hostState.sends).toHaveLength(0);
    expect(lastText(recorded)).toContain('已经绑定了另一位用户');
  });

  test('白名单优先于“第一个用户”', async () => {
    const { bridge, store, hostState } = await setup();
    await store.patchSettings({ allowedUsers: ['staff_9'] });

    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    expect(hostState.starts).toHaveLength(0);
    expect(store.value.ownerUserId).toBeNull();
  });

  test('/help 直接回命令，不找 agent', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('/help'));
    await bridge.whenIdle();


    expect(hostState.starts).toHaveLength(0);
    expect(lastText(recorded)).toContain('钉钉 ⇄ OpenChamber');
  });

  test('不认识的 /xxx 按原文转给 agent', async () => {
    const { bridge, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/compact'));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([{ sessionId: 'ses_1', prompt: '/compact' }]);
  });

  test('/s new 之后的下一条消息新建会话，标题生效', async () => {
    const { bridge, hostState, store } = await setup();
    bridge.handleInbound(callback('一'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/s new 第二个'));
    await bridge.whenIdle();
    expect(store.binding).toBeNull();

    bridge.handleInbound(callback('二'));
    await bridge.whenIdle();
    expect(hostState.starts).toHaveLength(2);
    expect(hostState.starts[1]).toMatchObject({ title: '第二个' });
    expect(store.binding?.sessionId).toBe('ses_2');
  });

  test('/s list 列出未归档的会话，/s list current 只看当前项目', async () => {
    const { bridge, recorded, store, hostState } = await setup();
    bridge.handleInbound(callback('一'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/s list'));
    await bridge.whenIdle();
    const list = lastText(recorded);
    expect(list).toContain('正在运行的会话');
    expect(list).toContain('应用里开的会话');
    expect(list).toContain('另一个会话');
    expect(list).toContain('共 3 个');

    bridge.handleInbound(callback('/s switch 2'));
    await bridge.whenIdle();
    expect(store.binding?.sessionId).toBe('ses_app_1');

    bridge.handleInbound(callback('继续这个会话'));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([{ sessionId: 'ses_app_1', prompt: '继续这个会话' }]);
  });

  test('/s list current 只看当前项目的会话', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('一'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/s list current'));
    await bridge.whenIdle();
    const listing = lastText(recorded);
    expect(listing).toContain('正在运行的会话');
    expect(listing).toContain('应用里开的会话');
    expect(listing).toContain('当前目录');
    expect(listing).not.toContain('另一个会话');
  });

  test('/s list 只列已打开项目的会话（含子目录），别处的与快捷聊天都不列', async () => {
    const { bridge, recorded } = await setup({
      hostProjects: [{ path: 'D:/proj', label: 'Proj' }],
      sessions: [
        { id: 'ses_in', title: '项目里的', directory: 'D:/proj', updatedAt: 3 },
        { id: 'ses_sub', title: '子目录里的', directory: 'D:/proj/packages/app', updatedAt: 2 },
        { id: 'ses_out', title: '别处的', directory: 'D:/other', updatedAt: 1 },
        { id: 'ses_chat', title: '快捷聊天', directory: 'C:/Users/me/.config/openchamber/chats/2026-11-20/session-1', updatedAt: 4 },
      ],
    });
    bridge.handleInbound(callback('/s list'));
    await bridge.whenIdle();
    const listing = lastText(recorded);
    expect(listing).toContain('已打开项目');
    expect(listing).toContain('项目里的');
    expect(listing).toContain('子目录里的');
    expect(listing).not.toContain('别处的');
    expect(listing).not.toContain('快捷聊天');
    expect(listing).toContain('共 2 个');
  });

  test('读不到 OpenChamber 项目列表时不筛会话', async () => {
    const { bridge, recorded } = await setup({ hostProjects: null });
    bridge.handleInbound(callback('/s list'));
    await bridge.whenIdle();
    const listing = lastText(recorded);
    expect(listing).toContain('正在运行的会话');
    expect(listing).toContain('另一个会话');
  });

  test('没有读取权限时说清楚去哪批准', async () => {
    const { bridge, recorded } = await setup({ withReader: false });
    bridge.handleInbound(callback('/s list'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('设置 → 扩展');
  });

  test('附件会下载到本机并写进 prompt', async () => {
    const { bridge, hostState } = await setup();
    bridge.handleInbound(callback('看看这张图', {
      msgtype: 'picture',
      text: undefined,
      content: { downloadCode: 'code-1' },
    }));
    await bridge.whenIdle();
    expect(String((hostState.starts[0] as { prompt: string }).prompt)).toContain('附件路径：');
  });
});

describe('插件投递', () => {
  test('sendOutboxJob 把文字和图片都发到绑定的钉钉会话', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    const dir = await mkdtemp(path.join(os.tmpdir(), 'dingtalk-files-'));
    dirs.push(dir);
    const image = path.join(dir, 'shot.png');
    await mkdir(dir, { recursive: true });
    await writeFile(image, Buffer.from('png-bytes'));

    await bridge.sendOutboxJob({ text: '任务完成，见附图。', files: [image] });

    const text = recorded.filter((item) => item.kind === 'webhook' && item.text === '任务完成，见附图。');
    expect(text).toHaveLength(1);
    expect(recorded.some((item) => item.kind === 'image')).toBe(true);
  });

  test('没有绑定时明确失败，不会静默丢掉', async () => {
    const { bridge } = await setup();
    await expect(bridge.sendOutboxJob({ text: '你好' })).rejects.toThrow('还没有绑定用户');
  });

  test('文件不存在时报出是哪个文件', async () => {
    const { bridge } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await expect(bridge.sendOutboxJob({ files: ['D:/definitely/missing.txt'] })).rejects.toThrow('missing.txt');
  });
});

describe('会话事件', () => {  test('turn-finished 把回复发回钉钉', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await bridge.handleEvent(event('turn-finished', 'ses_1', {
      type: 'turn-finished',
      sessionTitle: '问候',
      reply: '你好，我在。',
      replyTruncated: false,
    }));
    expect(lastText(recorded)).toContain('你好，我在。');
  });

  test('回合开始建卡片，结束用卡片收口', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await bridge.handleEvent(event('turn-started', 'ses_1', {
      type: 'turn-started',
      sessionTitle: '问候',
    }));
    await waitFor(() => recorded.some((item) => item.kind === 'card-create'));
    expect(recorded.some((item) => item.kind === 'card-create')).toBe(true);

    await bridge.handleEvent(event('turn-finished', 'ses_1', {
      type: 'turn-finished',
      sessionTitle: '问候',
      reply: '卡片里的回复',
      replyTruncated: false,
    }));
    const finish = recorded.find((item) => item.kind === 'card-finish');
    expect(String(finish?.text)).toContain('卡片里的回复');
  });

  test('超长回复走文本分片，不塞进卡片', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await bridge.handleEvent(event('turn-started', 'ses_1', { type: 'turn-started', sessionTitle: null }));
    await waitFor(() => recorded.some((item) => item.kind === 'card-create'));

    const long = Array.from({ length: 60 }, (_, index) => `第 ${index} 段：${'内容'.repeat(60)}`).join('\n');
    await bridge.handleEvent(event('turn-finished', 'ses_1', {
      type: 'turn-finished',
      sessionTitle: null,
      reply: long,
      replyTruncated: false,
    }));
    expect(recorded.some((item) => item.kind === 'card-fail')).toBe(true);
    const chunks = recorded.filter((item) => item.kind === 'webhook');
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(String(chunk.text).length).toBeLessThanOrEqual(3_500);
  });

  test('/stop 会把还挂着的卡片收口', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await bridge.handleEvent(event('turn-started', 'ses_1', { type: 'turn-started', sessionTitle: null }));
    await waitFor(() => recorded.some((item) => item.kind === 'card-create'));

    bridge.handleInbound(callback('/stop'));
    await bridge.whenIdle();
    const failed = recorded.find((item) => item.kind === 'card-fail');
    expect(String(failed?.text)).toContain('停止');
    expect(lastText(recorded)).toContain('停止');
  });

  test('子会话的事件被忽略', async () => {    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    const request = event('turn-finished', 'ses_child', {
      type: 'turn-finished',
      sessionTitle: null,
      reply: '子任务完成',
      replyTruncated: false,
    });
    request.event.session.parentId = 'ses_1';
    const before = recorded.length;
    await bridge.handleEvent(request);
    expect(recorded.length).toBe(before);
  });

  test('未绑定的会话只在打开提醒时推送', async () => {
    const { bridge, recorded, store } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    const other = event('turn-finished', 'ses_other', {
      type: 'turn-finished',
      sessionTitle: '手动开的会话',
      reply: '做完了',
      replyTruncated: false,
    });

    const before = recorded.length;
    await bridge.handleEvent(other);
    expect(recorded.length).toBe(before);

    await store.patchSettings({ notifyOtherSessions: true });
    await bridge.handleEvent(other);
    expect(lastText(recorded)).toContain('做完了');
    expect(lastText(recorded)).toContain('手动开的会话');
  });

  test('turn-failed 让用户看到失败原因', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await bridge.handleEvent(event('turn-failed', 'ses_1', {
      type: 'turn-failed',
      sessionTitle: null,
      error: { type: 'provider', message: '额度不足' },
    }));
    expect(lastText(recorded)).toContain('额度不足');
  });

  test('授权请求：回复 1 就允许', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    await bridge.handleEvent(event('permission-asked', 'ses_1', {
      type: 'permission-asked',
      sessionTitle: '问候',
      action: 'bash',
      resources: ['rm -rf build'],
      message: null,
    }, { permission: { requestId: 'perm_1' } }));
    expect(lastText(recorded)).toContain('需要授权');

    bridge.handleInbound(callback('1'));
    await bridge.whenIdle();
    expect(hostState.answers).toEqual([
      { kind: 'permission', sessionId: 'ses_1', requestId: 'perm_1', answer: { decision: 'allow' } },
    ]);
  });

  test('授权请求：普通文字不算回答，照常发给 agent', async () => {
    const { bridge, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    await bridge.handleEvent(event('permission-asked', 'ses_1', null, { permission: { requestId: 'perm_1' } }));

    bridge.handleInbound(callback('先别执行'));
    await bridge.whenIdle();
    expect(hostState.answers).toHaveLength(0);
    expect(hostState.sends).toEqual([{ sessionId: 'ses_1', prompt: '先别执行' }]);
  });

  test('提问：序号回答映射成选项值', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    await bridge.handleEvent(event('question-asked', 'ses_1', {
      type: 'question-asked',
      sessionTitle: null,
      ask: {
        kind: 'form',
        id: 'frm_1',
        title: '选个颜色',
        fields: [{
          key: 'color',
          type: 'string',
          title: '颜色',
          description: null,
          required: true,
          options: [{ value: 'red', label: '红色' }, { value: 'blue', label: '蓝色' }],
        }],
      },
    }, { question: { kind: 'form', id: 'frm_1' } }));
    expect(lastText(recorded)).toContain('选个颜色');

    bridge.handleInbound(callback('2'));
    await bridge.whenIdle();
    expect(hostState.answers).toEqual([
      { kind: 'form', sessionId: 'ses_1', formId: 'frm_1', values: { color: 'blue' } },
    ]);
  });

  test('/status 显示待处理请求，/rq 关闭提问卡、/rp 拒绝权限卡', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/status'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('模式：');
    // 没有卡时 /rq 说明去哪了
    bridge.handleInbound(callback('/rq'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('没有待处理的提问卡');

    await bridge.handleEvent(event('permission-asked', 'ses_1', null, { permission: { requestId: 'perm_1' } }));
    await bridge.handleEvent(event('question-asked', 'ses_1', {
      type: 'question-asked',
      sessionTitle: null,
      ask: {
        kind: 'form',
        id: 'frm_9',
        title: '选一个',
        fields: [{
          key: 'pick',
          type: 'string',
          title: '选项',
          description: null,
          required: true,
          options: [{ value: 'a', label: 'A' }],
        }],
      },
    }, { question: { kind: 'form', id: 'frm_9' } }));

    bridge.handleInbound(callback('/status'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('等你回答：2');

    bridge.handleInbound(callback('/rq'));
    await bridge.whenIdle();
    expect(hostState.answers).toContainEqual({
      kind: 'form',
      sessionId: 'ses_1',
      formId: 'frm_9',
      values: null,
    });

    bridge.handleInbound(callback('/rp'));
    await bridge.whenIdle();
    expect(hostState.answers).toContainEqual({
      kind: 'permission',
      sessionId: 'ses_1',
      requestId: 'perm_1',
      answer: { decision: 'deny', message: '用户在钉钉里拒绝了' },
    });
  });
});




describe('命令：帮助与状态', () => {
  test('/help 列出已实现的命令，并说明哪些没有对应能力', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('/help'));
    await bridge.whenIdle();
    const help = lastText(recorded);
    expect(help).toContain('/s');
    expect(help).toContain('/ws');
    expect(help).toContain('/mg');
    expect(help).toContain('/history');
    expect(help).toContain('没有对应能力的命令未提供');
    expect(help).toContain('/fork');
  });

  test('/help <命令> 给出用法与例子', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('/help s'));
    await bridge.whenIdle();
    const topic = lastText(recorded);
    expect(topic).toContain('用法：/session list');
    expect(topic).toContain('/s list current');
  });

  test('/help 未知命令回清单而不是转发', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('/help fuck'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('没有 /fuck 这条命令');
    expect(hostState.sends).toHaveLength(0);
  });

  test('/status brief 只给摘要，full 带运行状态', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/status brief'));
    await bridge.whenIdle();
    const brief = lastText(recorded);
    expect(brief).toContain('模式：raw');
    expect(brief).not.toContain('运行状态');

    bridge.handleInbound(callback('/status full'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('运行状态：空闲');
  });

  test('打错的命令给提示，不当成聊天转给 agent', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('/statu'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('你想用的可能是 `/status`');
    expect(hostState.starts).toHaveLength(0);
  });

  test('没有对应能力的上游命令会说明，而不是转给 agent', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('/model list'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('没有对应能力');
    expect(lastText(recorded)).toContain('换模型');
    expect(hostState.starts).toHaveLength(0);
    expect(hostState.sends).toHaveLength(0);

    bridge.handleInbound(callback('/s pin 1'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('/s pin');
  });
});

describe('命令：工作区', () => {
  test('/ws list 只列 OpenChamber 已打开的项目，/ws switch 换目录并解绑', async () => {
    const dirA = await mkdtemp(path.join(os.tmpdir(), 'ws-a-'));
    const dirB = await mkdtemp(path.join(os.tmpdir(), 'ws-b-'));
    dirs.push(dirA, dirB);
    const { bridge, recorded, store } = await setup({
      hostProjects: [
        { path: dirA, label: '项目 A' },
        { path: dirB, label: '项目 B' },
      ],
    });
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/ws list'));
    await bridge.whenIdle();
    const listing = lastText(recorded);
    expect(listing).toContain('OpenChamber 已打开的项目');
    expect(listing).toContain(dirA);
    expect(listing).toContain(dirB);
    expect(listing).toContain('项目 A');
    expect(listing).toContain('共 2 个');

    bridge.handleInbound(callback('/ws switch 2'));
    await bridge.whenIdle();
    expect(store.settings.directory).toBe(dirB);
    expect(store.binding).toBeNull();
    expect(lastText(recorded)).toContain(dirB);
  });

  test('没有 OpenChamber 配置文件时退回 OpenCode 的项目列表', async () => {
    const { bridge, recorded } = await setup({ hostProjects: null, projects: ['D:/proj'] });
    bridge.handleInbound(callback('/ws list'));
    await bridge.whenIdle();
    const listing = lastText(recorded);
    expect(listing).toContain('OpenCode 识别的项目');
    expect(listing).toContain('D:/proj');
  });

  test('/ws add 只接受真实存在的目录', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ws-add-'));
    dirs.push(dir);
    const { bridge, recorded, store } = await setup();
    await store.patchSettings({ directory: '' });

    bridge.handleInbound(callback('/ws add D:/definitely/missing'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('这个目录不存在');

    bridge.handleInbound(callback(`/ws add ${dir}`));
    await bridge.whenIdle();
    expect(store.settings.directory).toBe(dir);
  });

  test('/ws status 显示默认目录与会话目录', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/ws status'));
    await bridge.whenIdle();
    const text = lastText(recorded);
    expect(text).toContain('默认目录');
    expect(text).toContain('D:/proj');
  });
});

describe('命令：历史、引用、合并、媒体、透传、重发', () => {
  test('/history 列出轮次，/history show 给全文', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/history'));
    await bridge.whenIdle();
    const listing = lastText(recorded);
    expect(listing).toContain('共 2 轮');
    expect(listing).toContain('第一轮提问');
    expect(listing).toContain('第二轮提问');
    expect(listing).toContain('第 2 轮全文');

    bridge.handleInbound(callback('/history show 1'));
    await bridge.whenIdle();
    const shown = lastText(recorded);
    expect(shown).toContain('**你**：第一轮提问');
    expect(shown).toContain('**agent**：第一轮回复');
  });

  test('/at f 引用文件，随下一条消息发出', async () => {
    const { bridge, recorded, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/at f D:/logs/build.log'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('已引用');

    bridge.handleInbound(callback('/at'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('D:/logs/build.log');

    bridge.handleInbound(callback('看看这个日志'));
    await bridge.whenIdle();
    const sent = String((hostState.sends[0] as { prompt: string }).prompt);
    expect(sent).toContain('看看这个日志');
    expect(sent).toContain('引用文件（/at）');
    expect(sent).toContain('D:/logs/build.log');
  });

  test('/at s 说明没有对应能力', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('/at s 2'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('没有对应能力');
    expect(lastText(recorded)).toContain('/at f');
  });

  test('/merge on：.. 追加、!! 立即提交', async () => {
    const { bridge, hostState, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/merge on'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('已开启打字合并');

    bridge.handleInbound(callback('帮我改下登录页 ..'));
    await bridge.whenIdle();
    expect(hostState.sends).toHaveLength(0);

    bridge.handleInbound(callback('跑一下测试 !!'));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([
      { sessionId: 'ses_1', prompt: '帮我改下登录页\n\n跑一下测试' },
    ]);
  });

  test('/merge on：静默窗口后自动合并', async () => {
    const { bridge, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/merge on'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('第一句'));
    await bridge.whenIdle();
    expect(hostState.sends).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([{ sessionId: 'ses_1', prompt: '第一句' }]);
  });

  test('/media on：无文字附件等下一条文字', async () => {
    const { bridge, hostState } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/media on'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('', { msgtype: 'picture', text: undefined, content: { downloadCode: 'code-1' } }));
    await bridge.whenIdle();
    expect(hostState.sends).toHaveLength(0);

    bridge.handleInbound(callback('这张图怎么看'));
    await bridge.whenIdle();
    const prompt = String((hostState.sends[0] as { prompt: string }).prompt);
    expect(prompt).toContain('这张图怎么看');
    expect(prompt).toContain('附件路径：');
  });

  test('/media at 换写法，/media off 发送暂存附件', async () => {
    const { bridge, hostState, recorded, store } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/media at'));
    await bridge.whenIdle();
    expect(store.settings.mediaRef).toBe('at');

    bridge.handleInbound(callback('/media on'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('', { msgtype: 'picture', text: undefined, content: { downloadCode: 'code-2' } }));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/media off'));
    await bridge.whenIdle();
    const prompt = String((hostState.sends[0] as { prompt: string }).prompt);
    expect(prompt).toContain('@');
    expect(lastText(recorded)).toContain('已关闭附件合并');
  });

  test('/raw on 之后命令也透传，只有 /raw 自己能关', async () => {
    const { bridge, hostState, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/raw on'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('透传：开');

    bridge.handleInbound(callback('/status'));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([{ sessionId: 'ses_1', prompt: '/status' }]);

    bridge.handleInbound(callback('/raw off'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/status'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('钉钉桥接状态');
  });

  test('/raw once 只透传下一条', async () => {
    const { bridge, hostState, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/raw once'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/help'));
    await bridge.whenIdle();
    expect(hostState.sends[0]).toEqual({ sessionId: 'ses_1', prompt: '/help' });
    expect(hostState.sends).toHaveLength(1);

    bridge.handleInbound(callback('/help'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('/s');
  });

  test('/next 重发发送失败的消息', async () => {
    const { bridge, recorded, controls } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();

    controls.failTimes = 1;
    bridge.handleInbound(callback('/help'));
    await bridge.whenIdle();
    expect(lastText(recorded)).not.toContain('/session');

    bridge.handleInbound(callback('/next'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('已重发 1 条');
    expect(recorded.some((item) => item.kind === 'webhook' && String(item.text).includes('/s'))).toBe(true);
  });
});
