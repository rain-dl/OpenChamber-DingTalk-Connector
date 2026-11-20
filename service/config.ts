/**
 * 扩展自己的持久化：设置、绑定关系、会话历史、最近动态。
 *
 * 位置是宿主给的 `OPENCHAMBER_SERVICE_DATA_DIR`（扩展专属目录，重装/重启都在），
 * 绝不能写在包目录里——那会触发扩展重载。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ReplyTarget } from './dingtalk/types.js';

/** 面板里能改的字段 + 钉钉命令里的开关。 */
export type BridgeSettings = {
  clientId: string;
  clientSecret: string;
  robotCode: string;
  /** AI 卡片模板，留空用内置模板。 */
  cardTemplateId: string;
  /** 新会话建在哪个项目目录。 */
  directory: string;
  /** 允许的钉钉 staffId；为空表示第一个发消息的人独占。 */
  allowedUsers: string[];
  /** 总开关。 */
  enabled: boolean;
  /** 别的会话结束一轮时也推到钉钉。 */
  notifyOtherSessions: boolean;
  /** `/raw on`：斜杠命令与文本原样交给 agent。 */
  rawMode: boolean;
  /** `/raw once`：只透传下一条。 */
  rawOnce: boolean;
  /** `/merge on`：连续打字合并成一条消息。 */
  merge: boolean;
  /** `/media on`：不带文字的附件等下一条文字一起发。 */
  mediaMerge: boolean;
  /** `/media at|path`：附件在 prompt 里的写法。 */
  mediaRef: 'at' | 'path';
  /** `/surface on`：给 agent 注入“你在钉钉里对话”的渠道提示词。 */
  surface: boolean;
};

/** 钉钉用户 ⇄ OpenChamber 会话。 */
export type Binding = {
  userId: string;
  sessionId: string;
  directory: string;
  title: string;
  target: ReplyTarget;
  boundAt: number;
};

/** 本桥接自己开过的会话，`/sessions`、`/switch` 用。 */
export type SessionEntry = {
  sessionId: string;
  title: string;
  directory: string;
  at: number;
};

export type ActivityEntry = {
  at: number;
  kind: 'in' | 'out' | 'error' | 'state';
  text: string;
};

export type Store = {
  settings: BridgeSettings;
  binding: Binding | null;
  ownerUserId: string | null;
  /** `/new 标题` 预定的会话标题，下一条消息开新会话时用掉。 */
  pendingTitle: string | null;
  sessions: SessionEntry[];
  activity: ActivityEntry[];
};

export const DEFAULT_SETTINGS: BridgeSettings = {
  clientId: '',
  clientSecret: '',
  robotCode: '',
  cardTemplateId: '',
  directory: '',
  allowedUsers: [],
  enabled: true,
  notifyOtherSessions: false,
  rawMode: false,
  rawOnce: false,
  merge: false,
  mediaMerge: false,
  mediaRef: 'path',
  surface: false,
};

const ACTIVITY_MAX = 30;
const SESSIONS_MAX = 30;

/**
 * 扩展的数据目录：宿主通过环境变量给，没给时退到用户主目录下，
 * 绝不写进扩展包本身（包内写入会触发重载）。
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const given = (env.OPENCHAMBER_SERVICE_DATA_DIR ?? '').trim();
  if (given) return given;
  return path.join(os.homedir(), '.openchamber-dingtalk');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

/** 把磁盘上的（可能是旧版本或被改坏的）JSON 收成一份能用的状态。 */
export function normalizeStore(value: unknown): Store {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const settingsRaw = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Record<string, unknown>;
  const settings: BridgeSettings = {
    clientId: text(settingsRaw.clientId),
    clientSecret: text(settingsRaw.clientSecret),
    robotCode: text(settingsRaw.robotCode),
    cardTemplateId: text(settingsRaw.cardTemplateId),
    directory: text(settingsRaw.directory),
    allowedUsers: stringList(settingsRaw.allowedUsers),
    enabled: bool(settingsRaw.enabled, true),
    notifyOtherSessions: bool(settingsRaw.notifyOtherSessions, false),
    rawMode: bool(settingsRaw.rawMode, false),
    rawOnce: bool(settingsRaw.rawOnce, false),
    merge: bool(settingsRaw.merge, false),
    mediaMerge: bool(settingsRaw.mediaMerge, false),
    mediaRef: settingsRaw.mediaRef === 'at' ? 'at' : 'path',
    surface: bool(settingsRaw.surface, false),
  };

  const bindingRaw = raw.binding && typeof raw.binding === 'object' ? (raw.binding as Record<string, unknown>) : null;
  const bindingTarget = bindingRaw?.target && typeof bindingRaw.target === 'object'
    ? (bindingRaw.target as Record<string, unknown>)
    : null;
  const binding: Binding | null = bindingRaw && bindingTarget && text(bindingRaw.sessionId) && text(bindingRaw.userId)
    ? {
      userId: text(bindingRaw.userId),
      sessionId: text(bindingRaw.sessionId),
      directory: text(bindingRaw.directory),
      title: text(bindingRaw.title),
      boundAt: Number.isFinite(bindingRaw.boundAt) ? Number(bindingRaw.boundAt) : Date.now(),
      target: {
        conversationType: bindingTarget.conversationType === 'group' ? 'group' : 'single',
        conversationId: text(bindingTarget.conversationId),
        ...(text(bindingTarget.messageId) ? { messageId: text(bindingTarget.messageId) } : {}),
        ...(text(bindingTarget.userId) ? { userId: text(bindingTarget.userId) } : {}),
        ...(text(bindingTarget.openConversationId) ? { openConversationId: text(bindingTarget.openConversationId) } : {}),
        ...(text(bindingTarget.sessionWebhook) ? { sessionWebhook: text(bindingTarget.sessionWebhook) } : {}),
        ...(Number.isFinite(bindingTarget.sessionWebhookExpiresAt)
          ? { sessionWebhookExpiresAt: Number(bindingTarget.sessionWebhookExpiresAt) }
          : {}),
      },
    }
    : null;

  const sessions: SessionEntry[] = Array.isArray(raw.sessions)
    ? raw.sessions
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => item !== null && !!text(item.sessionId))
      .map((item) => ({
        sessionId: text(item.sessionId),
        title: text(item.title),
        directory: text(item.directory),
        at: Number.isFinite(item.at) ? Number(item.at) : 0,
      }))
      .slice(0, SESSIONS_MAX)
    : [];

  const activity: ActivityEntry[] = Array.isArray(raw.activity)
    ? raw.activity
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => item !== null && !!text(item.text))
      .map((item): ActivityEntry => ({
        at: Number.isFinite(item.at) ? Number(item.at) : 0,
        kind: item.kind === 'in' || item.kind === 'out' || item.kind === 'error' ? item.kind : 'state',
        text: text(item.text).slice(0, 200),
      }))
      .slice(-ACTIVITY_MAX)
    : [];

  return {
    settings,
    binding,
    ownerUserId: text(raw.ownerUserId) || null,
    pendingTitle: text(raw.pendingTitle) || null,
    sessions,
    activity,
  };
}

export class ConfigStore {
  private readonly file: string;
  private state: Store;

  private constructor(file: string, state: Store) {
    this.file = file;
    this.state = state;
  }

  static async open(dataDir: string): Promise<ConfigStore> {
    const dir = dataDir || resolveDataDir();
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'bridge.json');
    let state: Store;
    try {
      state = normalizeStore(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // 坏文件不阻塞启动：备份后从默认值开始，用户重新填一次即可。
        await rename(file, `${file}.broken-${Date.now()}`).catch(() => undefined);
        console.warn(`[钉钉] 配置文件无法读取，已备份并从默认值开始: ${String(error)}`);
      }
      state = normalizeStore({});
    }
    return new ConfigStore(file, state);
  }

  get value(): Store {
    return this.state;
  }

  get settings(): BridgeSettings {
    return this.state.settings;
  }

  get binding(): Binding | null {
    return this.state.binding;
  }

  /** 合并设置并落盘。传 `undefined` 的字段保持不变。 */
  async patchSettings(patch: Partial<BridgeSettings>): Promise<BridgeSettings> {
    const next: BridgeSettings = {
      ...this.state.settings,
      ...(patch.clientId !== undefined ? { clientId: text(patch.clientId) } : {}),
      ...(patch.clientSecret !== undefined ? { clientSecret: text(patch.clientSecret) } : {}),
      ...(patch.robotCode !== undefined ? { robotCode: text(patch.robotCode) } : {}),
      ...(patch.cardTemplateId !== undefined ? { cardTemplateId: text(patch.cardTemplateId) } : {}),
      ...(patch.directory !== undefined ? { directory: text(patch.directory) } : {}),
      ...(patch.allowedUsers !== undefined ? { allowedUsers: stringList(patch.allowedUsers) } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.notifyOtherSessions !== undefined ? { notifyOtherSessions: patch.notifyOtherSessions } : {}),
      ...(patch.rawMode !== undefined ? { rawMode: patch.rawMode } : {}),
      ...(patch.rawOnce !== undefined ? { rawOnce: patch.rawOnce } : {}),
      ...(patch.merge !== undefined ? { merge: patch.merge } : {}),
      ...(patch.mediaMerge !== undefined ? { mediaMerge: patch.mediaMerge } : {}),
      ...(patch.mediaRef !== undefined ? { mediaRef: patch.mediaRef === 'at' ? 'at' : 'path' } : {}),
      ...(patch.surface !== undefined ? { surface: patch.surface } : {}),
    };
    this.state = { ...this.state, settings: next };
    await this.flush();
    return next;
  }

  async setBinding(binding: Binding | null): Promise<void> {
    this.state = { ...this.state, binding };
    await this.flush();
  }

  async setOwner(userId: string | null): Promise<void> {
    this.state = { ...this.state, ownerUserId: userId };
    await this.flush();
  }

  /** 记下一条新会话的标题；传 null 清掉。 */
  async setPendingTitle(title: string | null): Promise<void> {
    this.state = { ...this.state, pendingTitle: title ? text(title) : null };
    await this.flush();
  }

  /** 只更新回复目标（webhook 每次入站都会刷新）。 */
  async refreshTarget(target: ReplyTarget): Promise<void> {
    const binding = this.state.binding;
    if (!binding) return;
    this.state = { ...this.state, binding: { ...binding, target } };
    await this.flush();
  }

  async rememberSession(entry: SessionEntry): Promise<void> {
    const rest = this.state.sessions.filter((item) => item.sessionId !== entry.sessionId);
    const sessions = [entry, ...rest].slice(0, SESSIONS_MAX);
    this.state = { ...this.state, sessions };
    await this.flush();
  }

  async logActivity(kind: ActivityEntry['kind'], message: string): Promise<void> {
    const entry: ActivityEntry = { at: Date.now(), kind, text: message.slice(0, 200) };
    this.state = { ...this.state, activity: [...this.state.activity, entry].slice(-ACTIVITY_MAX) };
    await this.flush();
  }

  /** 原子写入，权限 0600：里面存着 AppSecret。 */
  private async flush(): Promise<void> {
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.file);
  }
}
