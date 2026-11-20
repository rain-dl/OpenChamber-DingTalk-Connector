/**
 * 面板展示逻辑：徽标不能等 `registered`，状态文案要写出绑定用户与缺目录的原因。
 *
 * 这些断言对应一次真实反馈：钉钉里收发都通了，面板却一直显示「连接中」，
 * 「允许的用户」也看不出谁绑定了。
 */

import { describe, expect, test } from 'bun:test';

import {
  allowedHelper,
  connectionBadge,
  initialDirectory,
  stateLabel,
  statusLines,
  type StatusPayload,
} from '../panel/view.js';

function status(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    configured: true,
    enabled: true,
    robotCode: 'robot1',
    cardTemplate: false,
    directory: '',
    allowedUsers: [],
    notifyOtherSessions: false,
    ownerUserId: null,
    stream: { state: 'connected', connected: true, registered: false, lastError: null, messages: 0 },
    binding: null,
    pending: [],
    activity: [],
    ...overrides,
  };
}

describe('连接徽标', () => {
  test('连上就算已连接，不用等钉钉回调', () => {
    expect(connectionBadge(status())).toEqual({ label: '已连接', tone: 'success' });
    expect(connectionBadge(status({
      stream: { state: 'connected', connected: true, registered: true, lastError: null, messages: 3 },
    }))).toEqual({ label: '已连接', tone: 'success' });
  });

  test('未配置、关闭、异常、连接中各说各的', () => {
    expect(connectionBadge(status({ configured: false })).label).toBe('未配置');
    expect(connectionBadge(status({ enabled: false })).label).toBe('已关闭');
    expect(connectionBadge(status({
      stream: { state: 'failed', connected: false, registered: false, lastError: 'HTTP 401', messages: 0 },
    }))).toEqual({ label: '连接异常', tone: 'error' });
    expect(connectionBadge(status({
      stream: { state: 'reconnecting', connected: false, registered: false, lastError: null, messages: 0 },
    }))).toEqual({ label: '重连中', tone: 'info' });
    expect(connectionBadge(status({ stream: null })).label).toBe('连接中');
  });

  test('状态名翻成中文', () => {
    expect(stateLabel('connected')).toBe('已连接');
    expect(stateLabel('reconnecting')).toBe('重连中');
    expect(stateLabel('weird')).toBe('weird');
    expect(stateLabel(null)).toBe('未知');
  });
});

describe('状态文案', () => {
  test('已连接但未注册时写明「已注册」缺失，不冒充未连接', () => {
    const lines = statusLines(status());
    expect(lines[1]).toBe('连接：已连接');
    const registered = statusLines(status({
      stream: { state: 'connected', connected: true, registered: true, lastError: null, messages: 2 },
    }));
    expect(registered[1]).toBe('连接：已连接 · 已注册');
    expect(registered[2]).toBe('已收消息：2 条');
  });

  test('绑定用户与白名单状态都写出来', () => {
    const lines = statusLines(status({ ownerUserId: 'staff_1', allowedUsers: ['staff_1'] }));
    expect(lines).toContain('已绑定用户：staff_1');
    expect(lines).toContain('白名单：staff_1');
    expect(lines.join('\n')).toContain('还没有会话');
  });

  test('有人绑定但没有目录时，指出要先设置目录', () => {
    const lines = statusLines(status({ ownerUserId: 'staff_1' }));
    expect(lines.join('\n')).toContain('先设置下面的默认项目目录');
  });

  test('还没人说话时给出发消息的引导', () => {
    expect(statusLines(status()).join('\n')).toContain('在钉钉里给机器人发一条消息');
  });

  test('会话信息带标题、ID 与目录', () => {
    const lines = statusLines(status({
      ownerUserId: 'staff_1',
      binding: { userId: 'staff_1', sessionId: 'ses_1', title: '钉钉 · 张三', directory: 'D:/proj', since: 1 },
    }));
    expect(lines).toContain('绑定会话：钉钉 · 张三');
    expect(lines).toContain('  会话 ID：ses_1');
    expect(lines).toContain('  目录：D:/proj');
  });
});

describe('允许的用户', () => {
  test('有人绑定时把 staffId 写在说明里', () => {
    expect(allowedHelper(status({ ownerUserId: '36222161818018' }))).toContain('当前绑定：36222161818018');
  });

  test('没人绑定时说明留空的含义', () => {
    expect(allowedHelper(status())).toContain('第一个发消息的人独占');
  });
});

describe('默认项目目录', () => {
  test('服务里存过的优先', () => {
    expect(initialDirectory(status({ directory: 'D:/saved' }), 'D:/current')).toEqual({ value: 'D:/saved' });
  });

  test('没存过就用当前打开的项目，并提示要保存', () => {
    expect(initialDirectory(status(), 'D:/current')).toEqual({
      value: 'D:/current',
      prefillHint: '已填入当前项目目录，点「保存设置」后生效。',
    });
  });

  test('两者都没有就留空', () => {
    expect(initialDirectory(status(), null)).toEqual({ value: '' });
    expect(initialDirectory(status(), '   ')).toEqual({ value: '' });
  });
});
