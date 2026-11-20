import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GuestSessionEventRequest, ServiceHost } from '@openchamber/sdk';

import { Bridge } from '../service/bridge.js';
import { ConfigStore } from '../service/config.js';
import type { DingTalkApi } from '../service/dingtalk/api.js';
import type { RobotCallback } from '../service/dingtalk/types.js';

const dirs: string[] = [];

type Recorded = { kind: string; [key: string]: unknown };

function fakeApi(recorded: Recorded[]): DingTalkApi {
  const push = (kind: string, extra: Record<string, unknown> = {}) => recorded.push({ kind, ...extra });
  return {
    sendSessionText: async (options: { text: string }) => push('webhook', { text: options.text }),
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

async function setup(): Promise<{
  bridge: Bridge;
  store: ConfigStore;
  recorded: Recorded[];
  hostState: { starts: unknown[]; sends: unknown[]; answers: unknown[] };
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
  const bridge = new Bridge({
    store,
    host: fakeHost(hostState),
    dataDir: dir,
    api: fakeApi(recorded),
    log: () => undefined,
    onStateChange: () => undefined,
  });
  return { bridge, store, recorded, hostState };
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

  test('/new 之后的下一条消息新建会话', async () => {
    const { bridge, hostState, store } = await setup();
    bridge.handleInbound(callback('一'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/new 第二个'));
    await bridge.whenIdle();
    expect(store.binding).toBeNull();

    bridge.handleInbound(callback('二'));
    await bridge.whenIdle();
    expect(hostState.starts).toHaveLength(2);
    expect(store.binding?.sessionId).toBe('ses_2');
  });

  test('/sessions 与 /switch 切回旧会话', async () => {
    const { bridge, recorded, store, hostState } = await setup();
    bridge.handleInbound(callback('一'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/new'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('二'));
    await bridge.whenIdle();

    bridge.handleInbound(callback('/sessions'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('ses_2');

    bridge.handleInbound(callback('/switch 2'));
    await bridge.whenIdle();
    expect(store.binding?.sessionId).toBe('ses_1');

    bridge.handleInbound(callback('回到旧会话'));
    await bridge.whenIdle();
    expect(hostState.sends).toEqual([{ sessionId: 'ses_1', prompt: '回到旧会话' }]);
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

  test('/pending 能看到还等着的请求', async () => {
    const { bridge, recorded } = await setup();
    bridge.handleInbound(callback('你好'));
    await bridge.whenIdle();
    bridge.handleInbound(callback('/pending'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('没有等待你回答');

    await bridge.handleEvent(event('permission-asked', 'ses_1', null, { permission: { requestId: 'perm_1' } }));
    bridge.handleInbound(callback('/pending'));
    await bridge.whenIdle();
    expect(lastText(recorded)).toContain('授权请求');
  });
});



