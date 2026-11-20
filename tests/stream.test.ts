import { afterEach, describe, expect, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocketServer, type WebSocket } from 'ws';

import { DingTalkStream } from '../service/dingtalk/stream.js';
import { TOPIC_ROBOT } from '../service/dingtalk/types.js';

const servers: Array<() => Promise<void>> = [];

/** 一个假的钉钉网关：HTTPS 握手 + WebSocket 推送，形状与线上一致。 */
async function fakeGateway(handshakeStatus = 200): Promise<{
  apiBase: string;
  frames: Array<Record<string, unknown>>;
  push: (frame: unknown) => void;
  waitForSocket: () => Promise<WebSocket>;
}> {
  const frames: Array<Record<string, unknown>> = [];
  let socket: WebSocket | null = null;
  let endpoint = '';
  let notify: (() => void) | null = null;

  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith('/v1.0/gateway/connections/open')) {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    request.on('end', () => {
      response.writeHead(handshakeStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(handshakeStatus === 200
        ? { endpoint, ticket: 'ticket-1' }
        : { code: 'InvalidAuthentication' }));
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (connected) => {
    socket = connected;
    connected.on('message', (data) => {
      frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    notify?.();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  endpoint = `ws://127.0.0.1:${port}/ws`;
  servers.push(() => new Promise<void>((resolve) => {
    wss.clients.forEach((client) => client.terminate());
    wss.close(() => server.close(() => resolve()));
  }));

  return {
    apiBase: `http://127.0.0.1:${port}`,
    frames,
    push: (frame) => socket?.send(JSON.stringify(frame)),
    waitForSocket: () => new Promise((resolve) => {
      if (socket) resolve(socket);
      else notify = () => resolve(socket!);
    }),
  };
}

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function quietLogger(): { log: () => void; warn: () => void; error: () => void } {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
});

describe('钉钉 Stream 长连接', () => {
  test('握手、注册、回调回执、去重与 ping 回显', async () => {
    const gateway = await fakeGateway();
    const messages: Array<{ text?: { content?: string } }> = [];
    const states: string[] = [];
    const stream = new DingTalkStream({
      credentials: { clientId: 'key', clientSecret: 'secret' },
      apiBase: gateway.apiBase,
      onMessage: (payload) => messages.push(payload as { text?: { content?: string } }),
      onStateChange: (status) => states.push(status.state),
      logger: quietLogger(),
      heartbeatIntervalMs: 60_000,
      connectTimeoutMs: 5_000,
    });

    await stream.start();
    await gateway.waitForSocket();
    expect(stream.connected).toBe(true);
    expect(stream.status().state).toBe('connected');

    gateway.push({ type: 'SYSTEM', headers: { topic: 'REGISTERED' }, data: '' });
    await until(() => stream.status().registered);
    expect(stream.status().registered).toBe(true);

    const callback = {
      type: 'CALLBACK',
      headers: { topic: TOPIC_ROBOT, messageId: 'mid-1', contentType: 'application/json' },
      data: JSON.stringify({ msgId: 'm1', senderStaffId: 'u1', msgtype: 'text', text: { content: '你好' } }),
    };
    gateway.push(callback);
    await until(() => messages.length === 1);
    expect(messages[0]?.text?.content).toBe('你好');

    await until(() => gateway.frames.some((frame) => (frame.headers as { messageId?: string } | undefined)?.messageId === 'mid-1'));
    const ack = gateway.frames.find((frame) => (frame.headers as { messageId?: string } | undefined)?.messageId === 'mid-1');
    expect(ack?.code).toBe(200);

    gateway.push(callback);
    await until(() => stream.status().duplicatesDropped === 1);
    expect(messages).toHaveLength(1);

    gateway.push({ type: 'SYSTEM', headers: { topic: 'ping', messageId: 'ping-1' }, data: '{}' });
    await until(() => gateway.frames.some((frame) => (frame.headers as { messageId?: string } | undefined)?.messageId === 'ping-1'));
    const pong = gateway.frames.find((frame) => (frame.headers as { messageId?: string } | undefined)?.messageId === 'ping-1');
    expect(pong?.code).toBe(200);

    const status = stream.status();
    expect(status.frames.system).toBeGreaterThanOrEqual(2);
    expect(status.frames.callback).toBe(2);
    expect(status.messagesReceived).toBe(1);
    expect(states).toContain('connected');

    await stream.stop();
    expect(stream.status().state).toBe('stopped');
  });

  test('握手被拒时首次启动报错，且状态可读', async () => {
    const gateway = await fakeGateway(401);
    const stream = new DingTalkStream({
      credentials: { clientId: 'key', clientSecret: 'bad' },
      apiBase: gateway.apiBase,
      onMessage: () => undefined,
      logger: quietLogger(),
      connectTimeoutMs: 3_000,
    });
    let message = '';
    try {
      await stream.start();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('401');
    expect(stream.status().state).toBe('failed');
    expect(stream.status().lastError).toContain('401');
    await stream.stop();
  });

  test('CALLBACK 帧里的坏 JSON 被忽略但照样回执', async () => {
    const gateway = await fakeGateway();
    let called = false;
    const stream = new DingTalkStream({
      credentials: { clientId: 'key', clientSecret: 'secret' },
      apiBase: gateway.apiBase,
      onMessage: () => {
        called = true;
      },
      logger: quietLogger(),
      heartbeatIntervalMs: 60_000,
      connectTimeoutMs: 5_000,
    });
    await stream.start();
    await gateway.waitForSocket();
    gateway.push({ type: 'CALLBACK', headers: { topic: TOPIC_ROBOT, messageId: 'mid-bad' }, data: '{not json' });
    await until(() => gateway.frames.some((frame) => (frame.headers as { messageId?: string } | undefined)?.messageId === 'mid-bad'));
    expect(called).toBe(false);
    await stream.stop();
  });
});
