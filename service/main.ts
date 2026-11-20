/**
 * 扩展的本地服务：钉钉 Stream 长连接 + 宿主的会话回调。
 *
 * 路由（都要求 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`）：
 *   GET  /health         宿主启动探针
 *   GET  /status         面板与 /status 用的状态快照（不含密钥）
 *   POST /config         保存设置并按需重连
 *   POST /disconnect     断开长连接
 *   POST /unbind         解除钉钉用户与会话的绑定
 *   POST /session-events 宿主的会话事件（turn-finished / permission-asked …）
 */

import { rm } from 'node:fs/promises';
import http from 'node:http';

import { createServiceHost, readSessionEventRequest } from '@openchamber/sdk';

import { Bridge } from './bridge.js';
import { ConfigStore, resolveDataDir, type BridgeSettings } from './config.js';
import { DingTalkStream, type StreamStatus } from './dingtalk/stream.js';
import { createOpenCodeReader } from './opencode.js';
import {
  drainOutbox,
  removeOutboxJob,
  statusFile,
  writeBridgeStatus,
  writeOutboxResult,
} from './spool.js';

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT ?? 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
const DATA_DIR = resolveDataDir(process.env);
const OUTBOX_INTERVAL_MS = 4_000;
const RETRY_FAILED_CONNECT_MS = 60_000;

const log = (message: string): void => {
  console.log(`[钉钉] ${message}`);
};

const host = createServiceHost({ env: process.env });

let store: ConfigStore;
let bridge: Bridge;
let stream: DingTalkStream | null = null;
let streamStatus: StreamStatus | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let emitTimer: NodeJS.Timeout | null = null;

/** 状态推送节流：面板只关心最后的形状。 */
function emitState(): void {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    void publishStatus();
    void host.emit('state', statusPayload() as never).catch(() => undefined);
  }, 250);
  emitTimer.unref?.();
}

/** 给 OpenCode 插件看的 `status.json`：它在应用外面，只能靠这个文件判断能不能发。 */
async function publishStatus(): Promise<void> {
  const settings = store.settings;
  const binding = store.binding;
  await writeBridgeStatus({
    v: 1,
    at: Date.now(),
    configured: !!settings.clientId && !!settings.clientSecret,
    enabled: settings.enabled,
    connected: !!streamStatus?.connected,
    bound: !!binding,
    ...(binding ? { userId: binding.userId, sessionId: binding.sessionId } : {}),
  }).catch(() => undefined);
}

/** 处理插件投进 outbox 的 `send_dingtalk` 任务。 */
async function pumpOutbox(): Promise<void> {
  await publishStatus();
  const entries = await drainOutbox().catch(() => []);
  for (const entry of entries) {
    const fail = async (error: string): Promise<void> => {
      log(`插件投递失败：${error}`);
      await store.logActivity('error', `插件投递失败：${error}`).catch(() => undefined);
      await writeOutboxResult(entry.job.id, { at: Date.now(), ok: false, error }).catch(() => undefined);
      await removeOutboxJob(entry.file).catch(() => undefined);
    };
    if (!store.binding) {
      await fail('钉钉里还没有绑定用户');
      continue;
    }
    if (!bridge.configured) {
      await fail('钉钉桥接还没配置 AppKey / AppSecret');
      continue;
    }
    try {
      await bridge.sendOutboxJob(entry.job);
      await writeOutboxResult(entry.job.id, { at: Date.now(), ok: true }).catch(() => undefined);
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error));
    } finally {
      await removeOutboxJob(entry.file).catch(() => undefined);
    }
  }
}

function statusPayload(): Record<string, unknown> {
  const settings = store.settings;
  return {
    configured: !!settings.clientId && !!settings.clientSecret,
    enabled: settings.enabled,
    clientId: settings.clientId,
    hasSecret: !!settings.clientSecret,
    robotCode: settings.robotCode || settings.clientId,
    cardTemplate: !!settings.cardTemplateId,
    directory: settings.directory,
    allowedUsers: settings.allowedUsers,
    notifyOtherSessions: settings.notifyOtherSessions,
    stream: streamStatus
      ? {
        state: streamStatus.state,
        connected: streamStatus.connected,
        registered: streamStatus.registered,
        lastError: streamStatus.lastError,
        lastFrameAt: streamStatus.lastFrameAt,
        lastCallbackAt: streamStatus.lastCallbackAt,
        messages: streamStatus.messagesReceived,
        reconnects: streamStatus.reconnectAttempts,
      }
      : null,
    ...bridge.snapshot(),
  };
}

async function stopStream(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const current = stream;
  stream = null;
  if (current) await current.stop().catch(() => undefined);
  streamStatus = null;
}

async function startStream(): Promise<void> {
  const settings = store.settings;
  // RobotCode 留空时按 AppKey 处理（钉钉控制台允许不填），握手本身只需要前两项。
  if (!settings.enabled || !settings.clientId || !settings.clientSecret) {
    return;
  }
  if (stream) return;

  const client = new DingTalkStream({
    credentials: { clientId: settings.clientId, clientSecret: settings.clientSecret },
    onMessage: (payload) => {
      bridge.handleInbound(payload);
      // 每条入站消息都会改变“已收消息 / 已注册 / 绑定”，让面板立刻看到，别停在旧快照上。
      emitState();
    },
    logger: console,
    onStateChange: (status) => {
      streamStatus = status;
      emitState();
    },
  });
  stream = client;
  try {
    await client.start();
    await host.needsConfiguration(null).catch(() => undefined);
    log('Stream 已启动');
    emitState();
  } catch (error) {
    log(`Stream 启动失败：${error instanceof Error ? error.message : String(error)}`);
    streamStatus = client.status();
    stream = null;
    await client.stop().catch(() => undefined);
    // 凭据错误重试也没有用，但网络抖动很常见：一分钟后再来一次。
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void startStream();
    }, RETRY_FAILED_CONNECT_MS);
    retryTimer.unref?.();
    emitState();
  }
}

async function restartStream(): Promise<void> {
  await stopStream();
  await startStream();
  emitState();
}

function readJson(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('请求体过大'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function json(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value ?? {});
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(body);
}

function parseSettingsPatch(body: string): Partial<BridgeSettings> {
  const raw = JSON.parse(body || '{}') as Record<string, unknown>;
  const patch: Partial<BridgeSettings> = {};
  for (const key of ['clientId', 'clientSecret', 'robotCode', 'cardTemplateId', 'directory'] as const) {
    if (typeof raw[key] === 'string') patch[key] = raw[key] as string;
  }
  if (Array.isArray(raw.allowedUsers)) {
    patch.allowedUsers = raw.allowedUsers.filter((item): item is string => typeof item === 'string');
  } else if (typeof raw.allowedUsers === 'string') {
    patch.allowedUsers = raw.allowedUsers.split(/[,，\s]+/).filter(Boolean);
  }
  if (typeof raw.enabled === 'boolean') patch.enabled = raw.enabled;
  if (typeof raw.notifyOtherSessions === 'boolean') patch.notifyOtherSessions = raw.notifyOtherSessions;
  return patch;
}

async function route(pathname: string, method: string, body: string): Promise<{ status: number; value: unknown } | null> {
  if (pathname === '/status' && method === 'GET') {
    return { status: 200, value: statusPayload() };
  }

  if (pathname === '/config' && method === 'POST') {
    const patch = parseSettingsPatch(body);
    const before = store.settings;
    const after = await store.patchSettings(patch);
    const credentialsChanged = before.clientId !== after.clientId
      || before.clientSecret !== after.clientSecret
      || before.robotCode !== after.robotCode
      || before.enabled !== after.enabled;
    if (!after.clientId || !after.clientSecret) {
      await host.needsConfiguration('在「钉钉桥接」面板里填入 AppKey、AppSecret 和 RobotCode。').catch(() => undefined);
    }
    if (credentialsChanged) {
      await restartStream();
    } else if (after.clientId && after.clientSecret && !stream) {
      await startStream();
    } else {
      emitState();
    }
    return { status: 200, value: statusPayload() };
  }

  if (pathname === '/disconnect' && method === 'POST') {
    await stopStream();
    await store.patchSettings({ enabled: false });
    emitState();
    return { status: 200, value: statusPayload() };
  }

  if (pathname === '/unbind' && method === 'POST') {
    await store.setBinding(null);
    await store.logActivity('state', '在面板里解除了绑定');
    emitState();
    return { status: 200, value: statusPayload() };
  }

  if (pathname === '/session-events' && method === 'POST') {
    const request = readSessionEventRequest(body);
    if (!request) return { status: 400, value: { ok: false, error: '无法识别的会话事件' } };
    // 先回 200：宿主有 10 秒预算，后面的推送可能慢得多。
    setImmediate(() => {
      void bridge.handleEvent(request).catch((error) => {
        log(`处理会话事件失败：${error instanceof Error ? error.message : String(error)}`);
      });
    });
    return { status: 200, value: { ok: true } };
  }

  return null;
}

const server = http.createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }
  const method = (request.method ?? 'GET').toUpperCase();
  readJson(request).then(
    (body) => route(pathname, method, body).then(
      (answer) => {
        if (!answer) json(response, 404, { error: 'not found' });
        else json(response, answer.status, answer.value);
      },
      (error) => {
        log(`路由失败 ${pathname}：${error instanceof Error ? error.message : String(error)}`);
        json(response, 500, { error: '内部错误' });
      },
    ),
    () => json(response, 400, { error: '请求体无法读取' }),
  );
});

async function main(): Promise<void> {
  store = await ConfigStore.open(DATA_DIR);
  const opencode = createOpenCodeReader(process.env);
  bridge = new Bridge({
    store,
    host,
    dataDir: DATA_DIR,
    log,
    onStateChange: emitState,
    ...(opencode ? { opencode } : {}),
  });

  server.listen(PORT, '127.0.0.1', () => {
    log(`服务已启动，端口 ${PORT}`);
  });

  await publishStatus();
  void pumpOutbox();
  const pumpTimer = setInterval(() => {
    void pumpOutbox();
  }, OUTBOX_INTERVAL_MS);
  pumpTimer.unref?.();

  const settings = store.settings;
  if (!settings.clientId || !settings.clientSecret) {
    await host.needsConfiguration('在「钉钉桥接」面板里填入 AppKey、AppSecret 和 RobotCode。').catch(() => undefined);
  } else {
    await host.needsConfiguration(null).catch(() => undefined);
    void startStream();
  }
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void (async () => {
      // 先把卡片收口，再删掉插件能看到的状态文件：服务不在时工具要明确报错。
      await bridge?.shutdown().catch(() => undefined);
      await stopStream();
      await rm(statusFile(), { force: true }).catch(() => undefined);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2_000).unref();
    })();
  });
}

void main().catch((error) => {
  log(`启动失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
