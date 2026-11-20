import { describe, expect, test } from 'bun:test';

import { createDingTalkApi, DingTalkApiError, normalizeSessionWebhook } from '../service/dingtalk/api.js';
import { splitDingTalkText, normalizeCardMarkdown, normalizeRobotCallback } from '../service/dingtalk/types.js';

type Call = { url: string; body: unknown; headers: Record<string, string> };

function fakeFetch(handler: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      url: String(url),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    };
    calls.push(call);
    const answer = handler(call);
    const status = answer.status ?? 200;
    return new Response(JSON.stringify(answer.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('令牌与发送', () => {
  test('令牌只取一次，主动消息带 robotCode', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/v1.0/oauth2/accessToken')) {
        return { body: { accessToken: 'token-1', expireIn: 7200 } };
      }
      return { body: { processQueryKey: 'ok' } };
    });
    const api = createDingTalkApi({ fetchImpl, now: () => 1_000 });

    await api.sendRobotText({
      credentials: { clientId: 'key', clientSecret: 'secret' },
      target: { type: 'user', userId: 'u1', robotCode: 'robot' },
      text: 'hello',
    });
    await api.sendRobotText({
      credentials: { clientId: 'key', clientSecret: 'secret' },
      target: { type: 'user', userId: 'u1', robotCode: 'robot' },
      text: 'again',
    });

    expect(calls.filter((call) => call.url.endsWith('/accessToken'))).toHaveLength(1);
    const send = calls.at(-1)!;
    expect(send.url).toContain('/v1.0/robot/oToMessages/batchSend');
    expect(send.headers['x-acs-dingtalk-access-token']).toBe('token-1');
    expect(send.body).toMatchObject({ robotCode: 'robot', userIds: ['u1'], msgKey: 'sampleText' });
  });

  test('HTTP 错误变成可识别的失败', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { code: 'InvalidAuthentication' } }));
    const api = createDingTalkApi({ fetchImpl });
    const failure = api.accessToken({ clientId: 'key', clientSecret: 'bad' }).catch((error: unknown) => error);
    const error = await failure;
    expect(error).toBeInstanceOf(DingTalkApiError);
    expect((error as DingTalkApiError).status).toBe(401);
  });

  test('200 里的 errcode 也算拒绝', async () => {
    const { fetchImpl } = fakeFetch((call) => (
      call.url.endsWith('/accessToken')
        ? { body: { accessToken: 't', expireIn: 7200 } }
        : { body: { errcode: 40035, errmsg: 'bad target' } }
    ));
    const api = createDingTalkApi({ fetchImpl });
    const error = await api.sendRobotText({
      credentials: { clientId: 'key', clientSecret: 'secret' },
      target: { type: 'group', openConversationId: 'g1', robotCode: 'robot' },
      text: 'hi',
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DingTalkApiError);
    expect((error as DingTalkApiError).code).toBe('send-rejected');
    expect((error as DingTalkApiError).providerCode).toBe('40035');
  });
});

describe('入站目标校验', () => {
  test('只接受钉钉域名的 https webhook', () => {
    expect(normalizeSessionWebhook('https://api.dingtalk.com/robot/send?x=1')).toBe('https://api.dingtalk.com/robot/send?x=1');
    expect(() => normalizeSessionWebhook('http://api.dingtalk.com/x')).toThrow();
    expect(() => normalizeSessionWebhook('https://evil.example.com/x')).toThrow();
    expect(() => normalizeSessionWebhook('https://user:pass@api.dingtalk.com/x')).toThrow();
  });
});

describe('消息归一化', () => {
  test('文本消息、群聊与 webhook', () => {
    const message = normalizeRobotCallback({
      msgId: 'm1',
      senderStaffId: 'u1',
      senderNick: '张三',
      conversationType: '2',
      conversationId: 'cid',
      msgtype: 'text',
      text: { content: '@机器人 帮我看看' },
      sessionWebhook: 'https://api.dingtalk.com/robot/send?x=1',
      sessionWebhookExpiredTime: 123,
    });
    expect(message?.text).toBe('帮我看看');
    expect(message?.target.conversationType).toBe('group');
    expect(message?.target.openConversationId).toBe('cid');
    expect(message?.target.sessionWebhookExpiresAt).toBe(123);
  });

  test('语音用转写文字，图片带下载码', () => {
    const voice = normalizeRobotCallback({
      msgId: 'm2',
      senderStaffId: 'u1',
      msgtype: 'audio',
      content: { recognition: '今天几号' },
    });
    expect(voice?.text).toBe('今天几号');

    const picture = normalizeRobotCallback({
      msgId: 'm3',
      senderStaffId: 'u1',
      msgtype: 'picture',
      content: { downloadCode: 'dc' },
    });
    expect(picture?.attachment).toEqual({ kind: 'image', downloadCode: 'dc' });
  });

  test('缺 id 或发送者的回调被丢掉', () => {
    expect(normalizeRobotCallback({ msgtype: 'text', text: { content: 'x' } })).toBeUndefined();
    expect(normalizeRobotCallback(null)).toBeUndefined();
  });
});

describe('长文本与换行', () => {
  test('按段落边界切分', () => {
    const text = `${'a'.repeat(30)}\n${'b'.repeat(30)}`;
    expect(splitDingTalkText(text, 40)).toEqual(['a'.repeat(30), 'b'.repeat(30)]);
    expect(splitDingTalkText('短文本', 100)).toEqual(['短文本']);
    expect(splitDingTalkText('   ', 10)).toEqual([]);
  });

  test('卡片里的换行变成 <br>，代码块不动', () => {
    expect(normalizeCardMarkdown('第一行\n第二行')).toBe('第一行<br>第二行');
    expect(normalizeCardMarkdown('```\na\nb\n```')).toBe('```\na\nb\n```');
    expect(normalizeCardMarkdown('- 一\n- 二')).toBe('- 一\n- 二');
  });
});
