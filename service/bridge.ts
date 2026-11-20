/**
 * 桥接核心：钉钉 ⇄ OpenChamber 会话。
 *
 * 三个方向：
 * 1. 钉钉入站消息 → `sessions.start` / `sessions.send`
 * 2. 会话事件（开始/结束/失败/授权/提问）→ 钉钉消息与 AI 卡片
 * 3. 钉钉里的回复 → `answerPermission` / `answerForm`
 *
 * 一位钉钉用户只对应一个会话（第一个说话的人成为主人，可用白名单收紧），
 * 这和原项目“单聊单用户绑定”的边界一致。
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  GuestFormField,
  GuestSessionEventRequest,
  ServiceFormValues,
  ServiceHost,
} from '@openchamber/sdk';

import { findHelpEntry, formatHelp, helpTopic } from './catalog.js';
import type { Binding, ConfigStore } from './config.js';
import { createDingTalkApi, type DingTalkApi } from './dingtalk/api.js';
import { DingTalkCardStream } from './dingtalk/card.js';
import { downloadAttachment } from './dingtalk/media.js';
import { sendMediaMessage, sendTextMessage, splitText, type SendContext } from './dingtalk/send.js';
import {
  normalizeRobotCallback,
  REACTION_DONE_NAME,
  REACTION_THINKING_NAME,
  type InboundAttachment,
  type InboundMessage,
  type ReplyTarget,
  type RobotCallback,
} from './dingtalk/types.js';
import {
  parseFormAnswer,
  parsePermissionAnswer,
  renderPermissionAsk,
  renderQuestionAsk,
} from './format.js';
import type { OpenCodeReader } from './opencode.js';
import { parseSlashCommand, splitMergeSuffix, DROPPED_COMMANDS, type SlashCommand } from './slash.js';

const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const REFUSAL_COOLDOWN_MS = 5 * 60_000;
const CARD_PLACEHOLDER = '⏳ 正在处理…';
/** 一条钉钉文本消息的安全上限；更长的回复切开依次发。 */
const TEXT_CHUNK_CHARS = 3_500;
/** 卡片放不下的回复改成文本，避免被钉钉静默截断。 */
const CARD_MAX_CHARS = 6_000;
/** `/merge on` 的静默窗口。 */
const MERGE_WINDOW_MS = 1_500;
const MERGE_MAX_PARTS = 10;
/** `/next` 的暂存上限。 */
const RETRY_MAX = 5;
/** `/surface on` 注入的渠道说明：短，且每句都是 agent 能照做的。 */
const SURFACE_TEXT = [
  '用户是通过钉钉和你对话的，回复会原样显示在钉钉聊天里。',
  '请用简短的 Markdown：少用表格，不要依赖按钮、图片预览或需要鼠标的操作。',
  '需要用户决定时直接问，他会在钉钉里回复，结果会转达给你。',
].join('\n');

type Pending =
  | { kind: 'permission'; at: number; sessionId: string; requestId: string }
  | { kind: 'form'; at: number; sessionId: string; formId: string; fields: GuestFormField[] };

type CardSlot = { stream: DingTalkCardStream; target: ReplyTarget; startedAt: number };

export type BridgeDeps = {
  store: ConfigStore;
  host: ServiceHost;
  dataDir: string;
  log: (message: string) => void;
  /** 状态变化时让面板刷新。 */
  onStateChange: () => void;
  /** 测试注入点：替换真实的钉钉 API 客户端。 */
  api?: DingTalkApi;
  /** 只读的会话/项目来源；没批准 `opencode` 角色时为 null。 */
  opencode?: OpenCodeReader | null;
};

export class Bridge {
  private readonly store: ConfigStore;
  private readonly host: ServiceHost;
  private readonly dataDir: string;
  private readonly log: (message: string) => void;
  private readonly onStateChange: () => void;
  private readonly api: DingTalkApi;
  private readonly opencode: OpenCodeReader | null;
  private readonly pendings: Pending[] = [];
  private readonly cards = new Map<string, CardSlot>();
  private readonly refusals = new Map<string, number>();
  private lastInbound: { target: ReplyTarget; at: number } | null = null;
  private tail: Promise<void> = Promise.resolve();
  /** 每个会话的回合代号：收尾时加一，正在建的卡片就会作废。 */
  private readonly epochs = new Map<string, number>();
  /** `/s list` 与 `/ws list` 最近一次的顺序，`switch 序号` 据此解析。 */
  private lastSessionList: string[] = [];
  private lastWorkspaceList: string[] = [];
  /** `/at f` 攒下的文件引用，随下一条消息发出。 */
  private refs: string[] = [];
  /** `/merge on` 的缓冲。 */
  private mergeParts: string[] = [];
  private mergeTimer: NodeJS.Timeout | null = null;
  /** `/media on` 暂存的附件。 */
  private heldFiles: string[] = [];
  /** 发送失败、等 `/next` 重发的消息。 */
  private retryQueue: Array<{ target: ReplyTarget; text: string; at: number }> = [];

  constructor(deps: BridgeDeps) {
    this.store = deps.store;
    this.host = deps.host;
    this.dataDir = deps.dataDir;
    this.log = deps.log;
    this.onStateChange = deps.onStateChange;
    this.api = deps.api ?? createDingTalkApi({ logger: console });
    this.opencode = deps.opencode ?? null;
  }

  /** 等排在队列里的入站消息都处理完（关停与测试用）。 */
  whenIdle(): Promise<void> {
    return this.tail;
  }

  /** 面板与 `/status` 用的快照（不含密钥）。 */
  snapshot(): Record<string, unknown> {
    const binding = this.store.binding;
    return {
      configured: this.configured,
      ownerUserId: this.store.value.ownerUserId,
      binding: binding
        ? {
          userId: binding.userId,
          sessionId: binding.sessionId,
          title: binding.title,
          directory: binding.directory,
          since: binding.boundAt,
        }
        : null,
      pending: this.pendings.map((item) => ({
        kind: item.kind,
        sessionId: item.sessionId,
        at: item.at,
        title: item.kind === 'form' ? item.fields[0]?.title ?? '提问' : '授权请求',
      })),
      sessions: this.store.value.sessions.length,
      activity: this.store.value.activity.slice(-12).reverse(),
    };
  }

  get configured(): boolean {
    const settings = this.store.settings;
    return !!settings.clientId && !!settings.clientSecret;
  }

  get robotCode(): string {
    const settings = this.store.settings;
    return settings.robotCode || settings.clientId;
  }

  private get credentials() {
    return { clientId: this.store.settings.clientId, clientSecret: this.store.settings.clientSecret };
  }

  private fallbackTarget(): ReplyTarget | null {
    const binding = this.store.binding;
    if (binding) return binding.target;
    const owner = this.store.value.ownerUserId;
    if (!owner) return null;
    return { conversationType: 'single', conversationId: '', userId: owner };
  }

  private send(target: ReplyTarget | null, text: string): Promise<void> {
    if (!target) return Promise.reject(new Error('没有可用的钉钉回复目标'));
    const ctx: SendContext = {
      api: this.api,
      credentials: this.credentials,
      robotCode: this.robotCode,
      target,
      markdown: true,
    };
    return sendTextMessage(text, ctx);
  }

  private async reply(target: ReplyTarget | null, text: string): Promise<void> {
    try {
      await this.sendChecked(target, text);
    } catch (error) {
      await this.store.logActivity('error', `回复失败：${errorText(error)}`);
      this.log(`回复钉钉失败：${errorText(error)}`);
      // 限流或网络抖动时留着，`/next` 可以重发。
      this.enqueueRetry(target, text);
    }
  }

  /** 发送并让失败冒泡（`send_dingtalk` 工具要如实告诉 agent）。 */
  private async sendChecked(target: ReplyTarget | null, text: string): Promise<void> {
    for (const chunk of this.chunks(text)) {
      await this.send(target, chunk);
    }
    await this.store.logActivity('out', text);
  }

  /** 插件投递的任务：一条文字 + 若干本机文件。 */
  async sendOutboxJob(job: { text?: string; files?: string[] }): Promise<void> {
    const target = this.fallbackTarget();
    if (!target) throw new Error('钉钉里还没有绑定用户');
    const text = job.text?.trim() ?? '';
    if (text) await this.sendChecked(target, text);
    for (const file of job.files ?? []) {
      await this.sendFileTo(target, file);
    }
  }

  private async sendFileTo(target: ReplyTarget, file: string): Promise<void> {
    const resolved = path.resolve(file);
    let bytes: Buffer;
    try {
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('不是一个文件');
      if (info.size > ATTACHMENT_MAX_BYTES) throw new Error(`文件超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`);
      bytes = await readFile(resolved);
    } catch (error) {
      throw new Error(`读不到附件 ${file}：${errorText(error)}`);
    }
    const name = path.basename(resolved);
    const kind = /\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ? 'image' : 'file';
    await sendMediaMessage(kind, bytes, name, {
      api: this.api,
      credentials: this.credentials,
      robotCode: this.robotCode,
      target,
    });
    await this.store.logActivity('out', `附件 ${name}`);
  }

  /** 服务关停前把还挂着的卡片收口。 */
  async shutdown(): Promise<void> {
    await this.closeCards('服务已停止，这一轮的结果请在 OpenChamber 里查看。');
  }

  /** 钉钉单条消息放不下长回复，按段落切开依次发。 */
  private chunks(text: string): string[] {
    const body = text.trim();
    if (body.length <= TEXT_CHUNK_CHARS) return body ? [body] : [];
    return splitText(body, TEXT_CHUNK_CHARS);
  }

  // ─── 入站 ───────────────────────────────────────────────────────────

  /** 钉钉 Stream 推来一条机器人消息。 */
  handleInbound(callback: RobotCallback): void {
    const message = normalizeRobotCallback(callback);
    if (!message) {
      this.log('忽略了一条无法识别的钉钉消息');
      return;
    }
    this.enqueue(() => this.processInbound(message));
  }

  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task, task).catch((error) => {
      this.log(`处理失败：${errorText(error)}`);
    });
  }

  private async processInbound(message: InboundMessage): Promise<void> {
    const settings = this.store.settings;
    this.lastInbound = { target: message.target, at: Date.now() };

    if (!this.allowed(message.senderId)) {
      await this.refuse(message);
      return;
    }

    if (!settings.allowedUsers.length && !this.store.value.ownerUserId) {
      await this.store.setOwner(message.senderId);
      await this.store.logActivity('state', `已绑定第一位用户 ${message.senderId}`);
      this.onStateChange();
    }

    const binding = this.store.binding;
    if (binding && binding.userId === message.senderId) {
      await this.store.refreshTarget(message.target);
      this.onStateChange();
    }

    let text = message.text?.trim() ?? '';
    await this.store.logActivity('in', text ? `${message.senderNick ?? message.senderId}: ${text}` : `${message.senderNick ?? message.senderId} 发来附件`);
    void this.react(REACTION_THINKING_NAME, message.target.messageId);

    // 1. `/raw` 透传：连命令都不拦，只有 /raw 自己例外（否则关不掉）。
    if (settings.rawMode || settings.rawOnce) {
      if (!/^\/raw(?:\s|$)/i.test(text)) {
        if (settings.rawOnce && !settings.rawMode) await this.store.patchSettings({ rawOnce: false });
        const rawPrompt = await this.buildPrompt(message, text);
        if (rawPrompt) await this.deliver(message.target, senderOf(message), rawPrompt);
        return;
      }
    }

    // 2. `/merge on` 时正文末尾的 `..` / `!!`（命令不参与）。
    let mergeMode: 'append' | 'submit' | 'auto' = 'auto';
    if (settings.merge && text && !text.startsWith('/')) {
      const split = splitMergeSuffix(text);
      text = split.text;
      mergeMode = split.mode;
    }

    if (text.startsWith('/')) {
      const handled = await this.handleCommand(message, text);
      if (handled) return;
      // 不认识的 /xxx 按原文转给 agent，和原项目一致。
    }

    if (text && this.pendings.length > 0) {
      const answered = await this.answerPending(message, text);
      if (answered) return;
    }

    const prompt = await this.buildPrompt(message, text);
    if (!prompt) {
      // 附件被 `/media on` 暂存了，等文字；否则是真的没内容。
      if (this.heldFiles.length > 0) return;
      await this.reply(message.target, '这条消息里没有可以转给 agent 的内容。');
      return;
    }

    if (this.store.settings.merge) {
      this.mergeParts.push(prompt);
      if (mergeMode === 'submit' || this.mergeParts.length >= MERGE_MAX_PARTS) {
        await this.flushMerge(message.target, senderOf(message));
        return;
      }
      if (mergeMode === 'append') return; // 等 `!!` 或 /merge off
      this.scheduleMergeFlush(message.target, senderOf(message));
      return;
    }

    await this.deliver(message.target, senderOf(message), prompt);
  }

  private allowed(senderId: string): boolean {
    const settings = this.store.settings;
    const owner = this.store.value.ownerUserId;
    if (settings.allowedUsers.length > 0) return settings.allowedUsers.includes(senderId);
    if (!owner) return true;
    return owner === senderId;
  }

  private async refuse(message: InboundMessage): Promise<void> {
    const until = this.refusals.get(message.senderId) ?? 0;
    if (until > Date.now()) return;
    this.refusals.set(message.senderId, Date.now() + REFUSAL_COOLDOWN_MS);
    await this.reply(
      message.target,
      '这个机器人已经绑定了另一位用户，暂时不能响应你。需要换人请先在 OpenChamber 的「钉钉桥接」面板里解除绑定。',
    );
  }

  /** 图片/文件先落到本机，prompt 里给出绝对路径；`/media on` 时先攒着。 */
  private async buildPrompt(message: InboundMessage, text: string): Promise<string> {
    const parts: string[] = [];
    if (text) parts.push(text);

    const files: string[] = [];
    if (message.attachment) {
      try {
        const saved = await this.downloadToData(message.attachment);
        if (!text && this.store.settings.mediaMerge) {
          this.heldFiles.push(saved);
          await this.store.logActivity('state', `附件暂存，等下一条文字：${path.basename(saved)}`);
          return '';
        }
        files.push(saved);
      } catch (error) {
        parts.push(`（有一个钉钉附件没能下载：${errorText(error)}）`);
      }
    }

    const outgoing = [...this.heldFiles.splice(0), ...files];
    if (outgoing.length > 0) parts.push(this.fileLines(outgoing));
    if (this.refs.length > 0) {
      parts.push(refLines(this.refs));
      this.refs = [];
    }

    return parts.join('\n').trim();
  }

  private async downloadToData(attachment: InboundAttachment): Promise<string> {
    const downloaded = await downloadAttachment(
      this.api,
      { ...this.credentials, robotCode: this.robotCode, cardTemplateId: '' },
      attachment,
      { robotCode: this.robotCode, maxBytes: ATTACHMENT_MAX_BYTES },
    );
    const dir = path.join(this.dataDir, 'uploads');
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dir, `${stamp}-${downloaded.fileName}`);
    await writeFile(target, downloaded.bytes, { mode: 0o600 });
    await this.store.logActivity('state', `附件已保存：${downloaded.fileName}`);
    return target;
  }

  /** `/media at|path` 决定附件在 prompt 里的写法；两种都只是指针，不内联内容。 */
  private fileLines(files: string[]): string {
    const style = this.store.settings.mediaRef;
    const header = files.length > 1 ? '钉钉附件已保存到本机：' : '钉钉发来一个附件，已保存到本机：';
    const lines = files.map((file) => (style === 'at' ? `@${file}` : `附件路径：${file}`));
    return [header, ...lines, '需要时请直接读取这个文件。'].join('\n');
  }

  /** 找到（或新建）会话并把 prompt 发过去。 */
  private async deliver(target: ReplyTarget, sender: { id: string; nick?: string }, prompt: string): Promise<void> {
    const binding = this.store.binding;
    if (binding && binding.sessionId) {
      try {
        await this.host.sessions.send(binding.sessionId, prompt);
        return;
      } catch (error) {
        const gone = /404|not.?found/i.test(errorText(error));
        await this.store.logActivity('error', `发送到会话失败：${errorText(error)}`);
        if (!gone) {
          await this.reply(
            binding.target,
            `没能把消息送到 OpenChamber：${errorText(error)}\n回复 /s new 可以开一个新会话。`,
          );
          return;
        }
        await this.store.setBinding(null);
        this.onStateChange();
      }
    }
    await this.startSession(target, sender, prompt);
  }

  private async startSession(target: ReplyTarget, sender: { id: string; nick?: string }, prompt: string): Promise<void> {
    const directory = this.store.settings.directory;
    if (!directory) {
      await this.reply(
        target,
        '还差一步：在 OpenChamber 的「钉钉桥接」面板里选择默认项目目录，下一条消息就会开一个新会话。',
      );
      return;
    }
    const title = this.store.value.pendingTitle?.trim() || `钉钉 · ${sender.nick ?? sender.id}`;
    try {
      const started = await this.host.sessions.start({ prompt, directory, title });
      const binding: Binding = {
        userId: sender.id,
        sessionId: started.sessionId,
        directory: started.directory ?? directory,
        title,
        target,
        boundAt: Date.now(),
      };
      await this.store.setBinding(binding);
      if (this.store.value.pendingTitle) await this.store.setPendingTitle(null);
      await this.store.rememberSession({
        sessionId: binding.sessionId,
        title,
        directory: binding.directory,
        at: binding.boundAt,
      });
      await this.store.logActivity('state', `已新建会话 ${started.sessionId}`);
      this.onStateChange();
      void this.syncSurface();
    } catch (error) {
      await this.store.logActivity('error', `新建会话失败：${errorText(error)}`);
      await this.reply(
        target,
        `没能新建会话：${errorText(error)}\n请确认面板里的项目目录还在。`,
      );
    }
  }

  // ─── 会话事件 ───────────────────────────────────────────────────────

  /** 处理 OpenChamber 推来的会话事件（已经回过 200）。 */
  async handleEvent(request: GuestSessionEventRequest): Promise<void> {
    const { event, content } = request;
    const binding = this.store.binding;
    const isBound = !!binding && binding.sessionId === event.session.id;
    const isSubagent = !!event.session.parentId;

    if (isSubagent) return;

    switch (event.type) {
      case 'turn-started': {
        if (!isBound) return;
        const epoch = this.bumpEpoch(event.session.id);
        await this.react(REACTION_THINKING_NAME, binding?.target.messageId);
        void this.startCard(event.session.id, binding!.target, epoch);
        return;
      }
      case 'turn-finished': {
        const reply = content?.type === 'turn-finished' ? content.reply : '';
        const truncated = content?.type === 'turn-finished' ? content.replyTruncated : false;
        const title = content?.type === 'turn-finished' ? content.sessionTitle : null;
        if (isBound) {
          await this.finishTurn(event.session.id, reply, truncated, binding!.target);
          await this.react(REACTION_DONE_NAME, binding?.target.messageId);
          return;
        }
        if (this.store.settings.notifyOtherSessions) {
          await this.notifyOther(title, reply, event.project.directory);
        }
        return;
      }
      case 'turn-failed': {
        const error = content?.type === 'turn-failed' ? content.error : null;
        const detail = error ? `${error.type}: ${error.message}` : '未知错误';
        if (isBound) {
          await this.failTurn(event.session.id, `❌ 这一轮失败了：${detail}`, binding!.target);
          await this.react(REACTION_DONE_NAME, binding?.target.messageId);
          return;
        }
        if (this.store.settings.notifyOtherSessions) {
          await this.notifyOther(content?.type === 'turn-failed' ? content.sessionTitle : null, `❌ 失败：${detail}`, event.project.directory);
        }
        return;
      }
      case 'permission-asked': {
        if (!isBound || !event.permission) return;
        this.pendings.push({
          kind: 'permission',
          at: Date.now(),
          sessionId: event.session.id,
          requestId: event.permission.requestId,
        });
        this.trimPendings();
        if (content?.type === 'permission-asked') {
          await this.reply(binding!.target, renderPermissionAsk(content));
        } else {
          await this.reply(binding!.target, `🔐 agent 需要授权（${event.permission.requestId}）：回复 1 允许，2 拒绝。`);
        }
        this.onStateChange();
        return;
      }
      case 'question-asked': {
        if (!isBound || !event.question) return;
        if (content?.type === 'question-asked' && content.ask.kind === 'form') {
          this.pendings.push({
            kind: 'form',
            at: Date.now(),
            sessionId: event.session.id,
            formId: content.ask.id,
            fields: content.ask.fields,
          });
          this.trimPendings();
          await this.reply(binding!.target, renderQuestionAsk(content));
        } else if (content?.type === 'question-asked') {
          await this.reply(binding!.target, renderQuestionAsk(content));
        }
        this.onStateChange();
        return;
      }
      default:
        return;
    }
  }

  private trimPendings(): void {
    while (this.pendings.length > 5) this.pendings.shift();
  }

  /** 回合被中断或换了会话时，把还挂着的卡片收口，别让用户一直看到转圈。 */
  private async closeCards(note: string): Promise<void> {
    const cards = [...this.cards.values()];
    this.cards.clear();
    for (const card of cards) {
      await card.stream.fail(note).catch(() => undefined);
    }
  }

  private async startCard(sessionId: string, target: ReplyTarget, epoch: number): Promise<void> {
    const existing = this.cards.get(sessionId);
    if (existing) {
      await existing.stream.fail('新的回合已开始，这张卡片结束了。').catch(() => undefined);
      this.cards.delete(sessionId);
    }
    const stream = new DingTalkCardStream({
      api: this.api,
      credentials: this.credentials,
      robotCode: this.robotCode,
      target: cardTarget(target),
      ...(this.store.settings.cardTemplateId ? { cardTemplateId: this.store.settings.cardTemplateId } : {}),
      logger: console,
    });
    const started = await stream.start(CARD_PLACEHOLDER);
    if (!started) return;
    // 回合在卡片建好之前就结束了：不要再把它挂出去。
    if (this.epochs.get(sessionId) !== epoch) {
      await stream.fail('这一轮已经结束，卡片不再更新。').catch(() => undefined);
      return;
    }
    this.cards.set(sessionId, { stream, target, startedAt: Date.now() });
  }

  private bumpEpoch(sessionId: string): number {
    const next = (this.epochs.get(sessionId) ?? 0) + 1;
    this.epochs.set(sessionId, next);
    return next;
  }

  private async finishTurn(sessionId: string, reply: string, truncated: boolean, target: ReplyTarget): Promise<void> {
    this.bumpEpoch(sessionId);
    const body = reply.trim() || '（这一轮没有文字回复）';
    const text = truncated ? `${body}\n\n_（回复过长，已截断）_` : body;
    const card = this.cards.get(sessionId);
    this.cards.delete(sessionId);
    if (card && text.length > CARD_MAX_CHARS) {
      await card.stream.fail('这一轮的回复较长，已拆成下面的消息。').catch(() => undefined);
      await this.reply(target, text);
      return;
    }
    if (card && await card.stream.finish(text)) {
      await this.store.logActivity('out', `卡片回复：${text.slice(0, 80)}`);
      return;
    }
    await this.reply(target, text);
  }

  private async failTurn(sessionId: string, text: string, target: ReplyTarget): Promise<void> {
    this.bumpEpoch(sessionId);
    const card = this.cards.get(sessionId);
    this.cards.delete(sessionId);
    if (card && await card.stream.fail(text)) {
      await this.store.logActivity('out', text);
      return;
    }
    await this.reply(target, text);
  }

  private async notifyOther(title: string | null, reply: string, directory: string | null): Promise<void> {
    const body = reply.trim();
    if (!body) return;
    const target = this.fallbackTarget();
    if (!target) return;
    const name = title?.trim() || directory?.split(/[\\/]/).filter(Boolean).pop() || '另一个会话';
    await this.reply(target, `📣 **${name}**\n\n${body}`);
  }

  /** 🤔 / ✅ 表情回应，失败不影响主流程。 */
  private async react(name: string, messageId: string | undefined): Promise<void> {
    const conversationId = this.store.binding?.target.conversationId
      ?? this.lastInbound?.target.conversationId;
    if (!messageId || !conversationId) return;
    if (!this.configured) return;
    try {
      if (name === REACTION_THINKING_NAME) {
        await this.api.recallReaction({
          credentials: this.credentials,
          robotCode: this.robotCode,
          messageId,
          conversationId,
          reactionName: REACTION_DONE_NAME,
        }).catch(() => undefined);
      }
      await this.api.addReaction({
        credentials: this.credentials,
        robotCode: this.robotCode,
        messageId,
        conversationId,
        reactionName: name,
      });
    } catch {
      // 表情只是点缀，钉钉限流或权限不足都不该影响消息。
    }
  }

  // ─── 回答待处理的请求 ───────────────────────────────────────────────

  private async answerPending(message: InboundMessage, text: string): Promise<boolean> {
    const pending = this.pendings[0];
    if (!pending) return false;

    if (pending.kind === 'permission') {
      const answer = parsePermissionAnswer(text);
      if (!answer) return false;
      try {
        await this.host.sessions.answerPermission(pending.sessionId, pending.requestId, answer);
        this.pendings.shift();
        await this.reply(message.target, answer.decision === 'allow' ? '✅ 已允许。' : '⛔ 已拒绝。');
        await this.react(REACTION_DONE_NAME, message.target.messageId);
      } catch (error) {
        this.pendings.shift();
        await this.reply(
          message.target,
          `这个授权请求已经不需要回答了（${errorText(error)}）。`,
        );
      }
      this.onStateChange();
      return true;
    }

    const parsed = parseFormAnswer(pending.fields, text);
    if (!parsed.ok) {
      await this.reply(message.target, `还没识别你的回答：${parsed.error}`);
      return true;
    }
    try {
      await this.host.sessions.answerForm(pending.sessionId, pending.formId, parsed.values as ServiceFormValues);
      this.pendings.shift();
      await this.reply(message.target, '✅ 已提交回答。');
      await this.react(REACTION_DONE_NAME, message.target.messageId);
    } catch (error) {
      this.pendings.shift();
      await this.reply(message.target, `这个问题已经在别处回答过了（${errorText(error)}）。`);
    }
    this.onStateChange();
    return true;
  }

  // ─── 钉钉里的命令 ───────────────────────────────────────────────────

  // ─── 钉钉命令（语法对齐上游 help-catalog） ──────────────────────────

  private async handleCommand(message: InboundMessage, raw: string): Promise<boolean> {
    const target = message.target;
    const sender = senderOf(message);
    const command = parseSlashCommand(raw);

    if (!command) {
      const name = (raw.trim().split(/\s+/, 1)[0] ?? '').replace(/^\//, '');
      const suggestion = suggestCommand(name);
      if (suggestion) {
        const entry = findHelpEntry(suggestion);
        await this.reply(target, `未知命令 \`/${name}\`，你想用的可能是 \`/${suggestion}\`。\n用法：${entry?.usage ?? ''}`);
        return true;
      }
      return false;
    }

    try {
      switch (command.kind) {
        case 'help': {
          if (!command.topic) {
            await this.reply(target, formatHelp());
            return true;
          }
          const entry = findHelpEntry(command.topic);
          await this.reply(
            target,
            entry ? helpTopic(entry) : `没有 /${command.topic.replace(/^\//, '')} 这条命令。\n\n${formatHelp()}`,
          );
          return true;
        }

        case 'status': {
          await this.reply(target, await this.statusText(command.mode ?? 'full'));
          return true;
        }

        case 'stop': {
          const binding = this.store.binding;
          if (!binding) {
            await this.reply(target, '当前没有绑定的会话。');
            return true;
          }
          try {
            const result = await this.host.sessions.stop(binding.sessionId);
            // 被停下的回合不会再发 turn-finished，卡片要在这里收口。
            this.bumpEpoch(binding.sessionId);
            await this.closeCards('⏹ 这一轮被停止了。');
            await this.reply(target, result.stopped ? '⏹ 已请求停止这一轮。' : '这一轮已经结束了。');
          } catch (error) {
            await this.reply(target, `停止失败：${errorText(error)}`);
          }
          return true;
        }

        case 'next': {
          await this.flushRetryQueue(target);
          return true;
        }

        case 'session': {
          await this.sessionCommand(command, message);
          return true;
        }

        case 'workspace': {
          await this.workspaceCommand(command, message);
          return true;
        }

        case 'history': {
          await this.historyCommand(command, message);
          return true;
        }

        case 'at': {
          await this.atCommand(command, message);
          return true;
        }

        case 'merge': {
          if (command.mode === 'on') {
            await this.store.patchSettings({ merge: true });
            await this.reply(target, `已开启打字合并：停顿 ${MERGE_WINDOW_MS / 1000} 秒后合成一条；末尾带 .. 继续追加，带 !! 立即提交。`);
          } else if (command.mode === 'off') {
            await this.store.patchSettings({ merge: false });
            const pending = this.mergeParts.length;
            await this.flushMerge(target, sender);
            await this.reply(target, pending > 0 ? `已关闭打字合并，暂存的 ${pending} 段已发出。` : '已关闭打字合并。');
          } else {
            await this.reply(
              target,
              `打字合并：${this.store.settings.merge ? '开' : '关'}；窗口 ${MERGE_WINDOW_MS / 1000} 秒，上限 ${MERGE_MAX_PARTS} 段，当前暂存 ${this.mergeParts.length} 段。`,
            );
          }
          return true;
        }

        case 'media': {
          const settings = this.store.settings;
          if (command.action === 'merge') {
            await this.store.patchSettings({ mediaMerge: command.mode === 'on' });
            if (command.mode === 'off') await this.flushHeldFiles(target, sender);
            await this.reply(
              target,
              command.mode === 'on'
                ? '已开启附件合并：不带文字的图片/文件会和下一条文字一起发。'
                : '已关闭附件合并，暂存附件已单独发出。',
            );
          } else if (command.action === 'ref') {
            await this.store.patchSettings({ mediaRef: command.style });
            await this.reply(target, command.style === 'at' ? '附件在消息里写成 @路径。' : '附件在消息里写成「附件路径：…」。');
          } else {
            await this.reply(
              target,
              `附件合并：${settings.mediaMerge ? '开' : '关'}；写法：${settings.mediaRef === 'at' ? '@路径' : '附件路径'}；当前暂存 ${this.heldFiles.length} 个。`,
            );
          }
          return true;
        }

        case 'notify': {
          if (command.mode === 'tasks') {
            await this.reply(target, 'OpenChamber 没有任务事件，`/notify tasks` 没有对应能力。');
            return true;
          }
          if (command.mode === 'on' || command.mode === 'off') {
            await this.store.patchSettings({ notifyOtherSessions: command.mode === 'on' });
            this.onStateChange();
            await this.reply(target, `其它会话结束推送到钉钉：${command.mode === 'on' ? '已打开' : '已关闭'}。`);
            return true;
          }
          await this.reply(target, `其它会话提醒：${this.store.settings.notifyOtherSessions ? '开' : '关'}。用法 /notify on|off`);
          return true;
        }

        case 'surface': {
          if (command.mode === 'on' || command.mode === 'off') {
            await this.store.patchSettings({ surface: command.mode === 'on' });
            await this.syncSurface();
            this.onStateChange();
          }
          await this.reply(
            target,
            `渠道提示词：${this.store.settings.surface ? '开' : '关'}。开启后会给 agent 一段“你在钉钉里对话”的说明。`,
          );
          return true;
        }

        case 'raw': {
          if (command.mode === 'on') await this.store.patchSettings({ rawMode: true, rawOnce: false });
          else if (command.mode === 'once') await this.store.patchSettings({ rawOnce: true });
          else if (command.mode === 'off') await this.store.patchSettings({ rawMode: false, rawOnce: false });
          const settings = this.store.settings;
          const state = settings.rawMode ? '开' : settings.rawOnce ? '下一条' : '关';
          await this.reply(
            target,
            command.mode === 'status' ? `透传：${state}。用法 /raw on|off|once|status` : `透传：${state}。`,
          );
          return true;
        }

        case 'card': {
          await this.resolveCards(command.action, command.index, target);
          return true;
        }

        case 'dropped': {
          const reason = DROPPED_COMMANDS[command.command] ?? 'OpenChamber 没有对应能力。';
          await this.reply(target, `\`${command.command.replace(/^session /, '/s ')}\` 在 OpenChamber 里没有对应能力：${reason}`);
          return true;
        }

        default:
          return false;
      }
    } catch (error) {
      await this.reply(target, `命令执行失败：${errorText(error)}`);
      return true;
    }
  }

  // ─── /session ───────────────────────────────────────────────────────

  private async sessionCommand(
    command: Extract<SlashCommand, { kind: 'session' }>,
    message: InboundMessage,
  ): Promise<void> {
    const target = message.target;
    const binding = this.store.binding;

    if (command.action === 'status') {
      const lines = ['🗂 **当前会话**', ''];
      if (!binding) {
        lines.push('未绑定：下一条消息会新建，或用 `/s list` 选一个。');
      } else {
        lines.push(
          `标题：${binding.title || '未命名'}`,
          `目录：\`${binding.directory || '未知'}\``,
          `ID：\`${binding.sessionId}\``,
        );
        try {
          const status = await this.host.sessions.status(binding.sessionId);
          lines.push(`状态：${statusLabel(status.status)}`);
        } catch {
          lines.push('状态：会话已不可用，发一条消息会重建');
        }
      }
      await this.reply(target, lines.join('\n'));
      return;
    }

    if (command.action === 'new') {
      const previous = this.store.binding;
      await this.closeCards('已切换到新会话，这张卡片结束了。');
      await this.store.setBinding(null);
      await this.store.setPendingTitle(command.title ?? null);
      this.pendings.length = 0;
      this.onStateChange();
      await this.reply(
        target,
        `${previous ? '已解除当前会话；' : ''}下一条消息会新建会话${command.title ? `（标题：${command.title}）` : ''}。`,
      );
      return;
    }

    const reader = await this.requireReader(target);
    if (!reader) return;

    if (command.action === 'list') {
      const activeOnly = command.scope !== 'all';
      const directory = command.scope === 'current'
        ? (binding?.directory || this.store.settings.directory)
        : undefined;
      const sessions = await reader.listSessions({
        activeOnly,
        ...(directory ? { directory } : {}),
      });
      if (sessions.length === 0) {
        await this.reply(
          target,
          activeOnly
            ? '现在没有正在运行的会话。`/s list all` 可以看全部（已完成的不在默认列表里，归档的也不列）。'
            : directory
              ? `\`${directory}\` 下还没有会话。`
              : '还没有任何会话。',
        );
        return;
      }
      const limit = command.limit === 'all' ? sessions.length : Math.min(command.limit, sessions.length);
      const page = sessions.slice(0, limit);
      this.lastSessionList = page.map((session) => session.id);
      const scopeNote = activeOnly
        ? (directory ? '当前目录，进行中，' : '进行中，')
        : (directory ? '当前目录，' : '');
      const lines = [
        `🗂 **会话**（${scopeNote}共 ${sessions.length} 个${limit < sessions.length ? `，显示最近 ${limit} 个` : ''}）`,
        '',
      ];
      page.forEach((session, index) => {
        const mark = binding?.sessionId === session.id ? ' ✅' : '';
        const where = session.directory ? ` · ${session.directory}` : '';
        lines.push(`${index + 1}. ${session.title}${mark}`, `   \`${session.id}\`${where} · ${relativeTime(session.updatedAt)}`);
      });
      lines.push('', '切换：`/s switch 序号`；看全部（含已完成）：`/s list all`；只看当前项目：`/s list current`');
      await this.reply(target, lines.join('\n'));
      return;
    }

    // switch：编号按最近一次 /s list 的顺序（没有就先取全部未归档的会话）。
    let sessionId = command.target;
    if (/^\d+$/.test(command.target)) {
      const index = Number(command.target);
      let source = this.lastSessionList;
      if (source.length === 0) {
        const all = await reader.listSessions();
        source = all.map((session) => session.id);
        this.lastSessionList = source;
      }
      sessionId = source[index - 1] ?? '';
      if (!sessionId) {
        await this.reply(target, `没有第 ${index} 个会话，先看 /s list。`);
        return;
      }
    }

    const all = await reader.listSessions();
    const found = all.find((session) => session.id === sessionId || session.id.startsWith(sessionId));
    if (!found) {
      await this.reply(target, `没有找到会话「${command.target}」。`);
      return;
    }
    await this.closeCards('已切换会话，这张卡片结束了。');
    await this.store.setBinding({
      userId: message.senderId,
      sessionId: found.id,
      directory: found.directory,
      title: found.title,
      target,
      boundAt: Date.now(),
    });
    await this.store.rememberSession({
      sessionId: found.id,
      title: found.title,
      directory: found.directory,
      at: Date.now(),
    });
    await this.store.logActivity('state', `切换会话 ${found.id}`);
    this.onStateChange();
    await this.reply(target, `已切到「${found.title}」。`);
  }

  // ─── /workspace ─────────────────────────────────────────────────────

  private async workspaceCommand(
    command: Extract<SlashCommand, { kind: 'workspace' }>,
    message: InboundMessage,
  ): Promise<void> {
    const target = message.target;
    const settings = this.store.settings;

    if (command.action === 'status') {
      const binding = this.store.binding;
      await this.reply(
        target,
        [
          '📁 **工作区**',
          '',
          `默认目录：\`${settings.directory || '未设置'}\``,
          `当前会话目录：\`${binding?.directory || '（无）'}\``,
          '',
          '切换：`/ws list` 看编号，再 `/ws switch 序号`。',
        ].join('\n'),
      );
      return;
    }

    if (command.action === 'list') {
      const reader = await this.requireReader(target);
      if (!reader) return;
      const projects = await reader.listProjects();
      if (projects.length === 0) {
        await this.reply(target, '没有找到项目：`/ws status` 看当前目录，或用 `/ws add <路径>` 直接指定。');
        return;
      }
      const limit = command.limit === 'all' ? projects.length : Math.min(command.limit, projects.length);
      const page = projects.slice(0, limit);
      this.lastWorkspaceList = page.map((project) => project.worktree);
      const lines = [
        `📁 **工作区**（共 ${projects.length} 个${limit < projects.length ? `，显示 ${limit} 个` : ''}）`,
        '',
      ];
      page.forEach((project, index) => {
        const mark = settings.directory === project.worktree ? ' ✅' : '';
        lines.push(`${index + 1}. \`${project.worktree}\`${mark}`);
      });
      lines.push('', '切换：`/ws switch 序号` 或 `/ws switch 路径`');
      await this.reply(target, lines.join('\n'));
      return;
    }

    let directory = '';
    if (command.action === 'switch' && /^\d+$/.test(command.target)) {
      const index = Number(command.target);
      directory = this.lastWorkspaceList[index - 1] ?? '';
      if (!directory) {
        await this.reply(target, `没有第 ${index} 个项目，先看 /ws list。`);
        return;
      }
    } else {
      directory = command.action === 'switch' ? command.target : command.path;
    }

    if (!(await isDirectory(directory))) {
      await this.reply(target, `这个目录不存在：\`${directory}\``);
      return;
    }

    await this.closeCards('已切换工作区，这张卡片结束了。');
    await this.store.patchSettings({ directory });
    await this.store.setBinding(null);
    await this.store.setPendingTitle(null);
    this.pendings.length = 0;
    this.onStateChange();
    await this.reply(target, `已把默认目录设为 \`${directory}\`；下一条消息会在那里新建会话。`);
  }

  // ─── /history ───────────────────────────────────────────────────────

  private async historyCommand(
    command: Extract<SlashCommand, { kind: 'history' }>,
    message: InboundMessage,
  ): Promise<void> {
    const target = message.target;
    const binding = this.store.binding;
    if (!binding) {
      await this.reply(target, '还没有绑定会话：发一条消息，或 `/s list` 选一个。');
      return;
    }
    const reader = await this.requireReader(target);
    if (!reader) return;

    const turns = await reader.listTurns(binding.sessionId);
    if (turns.length === 0) {
      await this.reply(target, '这个会话还没有历史。');
      return;
    }

    if (command.action === 'show') {
      const turn = turns[command.index - 1];
      if (!turn) {
        await this.reply(target, `没有第 ${command.index} 轮（共 ${turns.length} 轮）。`);
        return;
      }
      await this.reply(
        target,
        [
          `🧾 **第 ${command.index} 轮**`,
          '',
          `**你**：${clip(turn.user, 3_000) || '（无文字）'}`,
          '',
          `**agent**：${clip(turn.reply, 6_000) || '（无文字）'}`,
        ].join('\n'),
      );
      return;
    }

    const limit = command.limit === 'all' ? turns.length : Math.min(command.limit, turns.length);
    const page = turns.slice(-limit);
    const offset = turns.length - page.length;
    const lines = [`🧾 **最近 ${page.length} 轮**（共 ${turns.length} 轮）`, ''];
    page.forEach((turn, index) => {
      lines.push(
        `${offset + index + 1}. 你：${clip(oneLine(turn.user), 60) || '（无文字）'}`,
        `   ↳ ${clip(oneLine(turn.reply), 80) || '（无回复）'}`,
      );
    });
    const last = turns[turns.length - 1];
    if (last) {
      lines.push(
        '',
        `**第 ${turns.length} 轮全文**`,
        '',
        `你：${clip(last.user, 1_500) || '（无文字）'}`,
        '',
        `agent：${clip(last.reply, 3_000) || '（无回复）'}`,
      );
    }
    lines.push('', '看某一轮：`/history show 序号`');
    await this.reply(target, lines.join('\n'));
  }

  // ─── /at ────────────────────────────────────────────────────────────

  private async atCommand(
    command: Extract<SlashCommand, { kind: 'at' }>,
    message: InboundMessage,
  ): Promise<void> {
    const target = message.target;
    switch (command.action) {
      case 'status': {
        if (this.refs.length === 0) {
          await this.reply(target, '还没有引用。用法：`/at f <路径>`，下一条消息会带上路径。');
          return;
        }
        await this.reply(
          target,
          ['📎 **已引用文件**', '', ...this.refs.map((file, index) => `${index + 1}. \`${file}\``), '', '清空：`/at clear`'].join('\n'),
        );
        return;
      }
      case 'file':
        this.refs.push(command.path);
        await this.reply(target, `已引用：\`${command.path}\`（下一条消息会带上）`);
        return;
      case 'remove': {
        const removed = this.refs.splice(command.index - 1, 1);
        await this.reply(target, removed.length > 0 ? `已移除：\`${removed[0]}\`` : `没有第 ${command.index} 个引用。`);
        return;
      }
      case 'clear':
        this.refs = [];
        await this.reply(target, '已清空引用。');
        return;
      case 'session':
        await this.reply(
          target,
          'OpenChamber 里的 agent 读不到别的会话，`/at s` 没有对应能力。要引用文件请用 `/at f <路径>`。',
        );
        return;
    }
  }

  // ─── /rq、/rp ───────────────────────────────────────────────────────

  private async resolveCards(
    action: 'close-question' | 'reject-permission',
    index: number | undefined,
    target: ReplyTarget,
  ): Promise<void> {
    const scope = index ? this.pendings.slice(index - 1, index) : [...this.pendings];
    const relevant = scope.filter((item) => (action === 'close-question' ? item.kind === 'form' : item.kind === 'permission'));
    if (relevant.length === 0) {
      await this.reply(
        target,
        index
          ? `第 ${index} 张卡不是${action === 'close-question' ? '提问卡' : '权限卡'}。`
          : action === 'close-question'
            ? '没有待处理的提问卡；权限卡用 `/rp`。'
            : '没有待处理的权限卡。',
      );
      return;
    }

    let done = 0;
    for (const pending of relevant) {
      try {
        if (action === 'close-question' && pending.kind === 'form') {
          await this.host.sessions.answerForm(pending.sessionId, pending.formId, null, '用户在钉钉里关闭了提问');
        } else if (action === 'reject-permission' && pending.kind === 'permission') {
          await this.host.sessions.answerPermission(pending.sessionId, pending.requestId, {
            decision: 'deny',
            message: '用户在钉钉里拒绝了',
          });
        }
        done += 1;
      } catch {
        // 已经在别处回答过了。
      }
      const at = this.pendings.indexOf(pending);
      if (at >= 0) this.pendings.splice(at, 1);
    }
    this.onStateChange();
    await this.reply(target, `已${action === 'close-question' ? '关闭' : '拒绝'} ${done} 张卡。`);
  }

  // ─── 合并、暂存、重发 ───────────────────────────────────────────────

  private scheduleMergeFlush(target: ReplyTarget, sender: { id: string; nick?: string }): void {
    if (this.mergeTimer) clearTimeout(this.mergeTimer);
    this.mergeTimer = setTimeout(() => {
      this.mergeTimer = null;
      this.enqueue(() => this.flushMerge(target, sender));
    }, MERGE_WINDOW_MS);
    this.mergeTimer.unref?.();
  }

  private async flushMerge(target: ReplyTarget, sender: { id: string; nick?: string }): Promise<void> {
    if (this.mergeTimer) {
      clearTimeout(this.mergeTimer);
      this.mergeTimer = null;
    }
    if (this.mergeParts.length === 0) return;
    const prompt = this.mergeParts.join('\n\n');
    this.mergeParts = [];
    await this.deliver(target, sender, prompt);
  }

  private async flushHeldFiles(target: ReplyTarget, sender: { id: string; nick?: string }): Promise<void> {
    if (this.heldFiles.length === 0) return;
    const files = this.heldFiles.splice(0);
    await this.deliver(target, sender, this.fileLines(files));
  }

  private enqueueRetry(target: ReplyTarget | null, text: string): void {
    if (!target) return;
    this.retryQueue.push({ target, text, at: Date.now() });
    while (this.retryQueue.length > RETRY_MAX) this.retryQueue.shift();
  }

  private async flushRetryQueue(target: ReplyTarget): Promise<void> {
    if (this.retryQueue.length === 0) {
      await this.reply(target, '没有暂存的消息。');
      return;
    }
    const queue = this.retryQueue.splice(0);
    let ok = 0;
    let firstError = '';
    for (const item of queue) {
      try {
        await this.sendChecked(item.target, item.text);
        ok += 1;
      } catch (error) {
        firstError = firstError || errorText(error);
        this.retryQueue.push(item);
      }
    }
    await this.reply(
      target,
      firstError
        ? `重发 ${ok} 条，仍有 ${this.retryQueue.length} 条失败：${firstError}`
        : `已重发 ${ok} 条暂存消息。`,
    );
  }

  // ─── 渠道提示词 ─────────────────────────────────────────────────────

  private async syncSurface(): Promise<void> {
    const settings = this.store.settings;
    const directory = this.store.binding?.directory || settings.directory || null;
    try {
      await this.host.setInstructions(directory, settings.surface ? SURFACE_TEXT : '');
    } catch (error) {
      this.log(`设置渠道提示词失败：${errorText(error)}`);
    }
  }

  // ─── 状态 ───────────────────────────────────────────────────────────

  private async requireReader(target: ReplyTarget): Promise<OpenCodeReader | null> {
    if (this.opencode) return this.opencode;
    await this.reply(
      target,
      '这条命令需要读取会话与项目的权限：在 设置 → 扩展 → 钉钉桥接 里批准「读取 OpenCode 会话」，然后重启 OpenChamber。',
    );
    return null;
  }

  private async statusText(mode: 'brief' | 'full' = 'full'): Promise<string> {
    const settings = this.store.settings;
    const binding = this.store.binding;
    const lines = [
      '📋 **钉钉桥接状态**',
      '',
      `凭据：${this.configured ? '已配置' : '未配置'}`,
      `当前会话：${binding ? binding.title || binding.sessionId : '未绑定'}`,
      `默认目录：\`${settings.directory || '未设置'}\``,
      `模式：raw ${settings.rawMode ? '开' : settings.rawOnce ? '下一条' : '关'} · merge ${settings.merge ? '开' : '关'} · media ${settings.mediaMerge ? '开' : '关'} · notify ${settings.notifyOtherSessions ? '开' : '关'} · surface ${settings.surface ? '开' : '关'}`,
    ];

    if (mode === 'full') {
      if (binding) {
        lines.push(`会话 ID：\`${binding.sessionId}\``, `会话目录：\`${binding.directory || '未知'}\``);
        try {
          const status = await this.host.sessions.status(binding.sessionId);
          lines.push(`运行状态：${statusLabel(status.status)}`);
        } catch {
          lines.push('运行状态：会话已不可用，发一条消息会重建');
        }
      }
      if (this.pendings.length > 0) {
        lines.push(`等你回答：${this.pendings.length} 个请求（1 允 / 2 拒，/rq 关闭提问，/rp 拒绝权限）`);
      }
      if (this.mergeParts.length > 0) lines.push(`暂存合并：${this.mergeParts.length} 段（/merge off 立即发送）`);
      if (this.heldFiles.length > 0) lines.push(`暂存附件：${this.heldFiles.length} 个（/media off 立即发送）`);
      if (this.refs.length > 0) lines.push(`已引用文件：${this.refs.length} 个（/at 查看）`);
      if (this.retryQueue.length > 0) lines.push(`待重发：${this.retryQueue.length} 条（/next）`);
      const activity = this.store.value.activity.slice(-3).reverse();
      if (activity.length > 0) {
        lines.push('', '最近动态：');
        for (const entry of activity) lines.push(`- ${entry.text}`);
      }
    }
    return lines.join('\n');
  }
}

function cardTarget(target: ReplyTarget) {
  if (target.conversationType === 'group') {
    return { type: 'group' as const, openConversationId: target.openConversationId ?? target.conversationId };
  }
  return { type: 'user' as const, ...(target.userId ? { userId: target.userId } : {}) };
}

function senderOf(message: InboundMessage): { id: string; nick?: string } {
  return { id: message.senderId, ...(message.senderNick ? { nick: message.senderNick } : {}) };
}

function refLines(files: string[]): string {
  return ['引用文件（/at）：', ...files.map((file) => `- ${file}`), '需要时请直接读取这些文件。'].join('\n');
}

function statusLabel(status: 'idle' | 'busy' | 'waiting'): string {
  return status === 'busy' ? '正在处理' : status === 'waiting' ? '等待你回答' : '空闲';
}

function clip(value: string, max: number): string {
  const body = value.trim();
  return body.length <= max ? body : `${body.slice(0, max - 1)}…`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function relativeTime(at: number): string {
  if (!at) return '时间未知';
  const delta = Date.now() - at;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} 小时前`;
  return `${Math.round(delta / 86_400_000)} 天前`;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** 打错的命令给个提示（上游的 mistyped-command 行为），别把它当成聊天转给 agent。 */
function suggestCommand(name: string): string | null {
  const needle = name.toLowerCase();
  if (!needle) return null;
  const candidates = ['help', 'status', 'stop', 'next', 'session', 'workspace', 'history', 'at', 'merge', 'media', 'notify', 'surface', 'raw', 'rq', 'rp'];
  let best: { name: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { name: candidate, distance };
  }
  return best?.name ?? null;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0]![col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        (matrix[row - 1]![col] ?? 0) + 1,
        (matrix[row]![col - 1] ?? 0) + 1,
        (matrix[row - 1]![col - 1] ?? 0) + cost,
      );
    }
  }
  return matrix[rows - 1]![cols - 1] ?? 0;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const value = (error as { message?: unknown } | null)?.message;
  return typeof value === 'string' ? value : String(error);
}
