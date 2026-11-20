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

import type { Binding, ConfigStore } from './config.js';
import { createDingTalkApi, type DingTalkApi } from './dingtalk/api.js';
import { DingTalkCardStream } from './dingtalk/card.js';
import { downloadAttachment } from './dingtalk/media.js';
import { sendMediaMessage, sendTextMessage, splitText, type SendContext } from './dingtalk/send.js';
import {
  normalizeRobotCallback,
  REACTION_DONE_NAME,
  REACTION_THINKING_NAME,
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

const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const REFUSAL_COOLDOWN_MS = 5 * 60_000;
const CARD_PLACEHOLDER = '⏳ 正在处理…';
/** 一条钉钉文本消息的安全上限；更长的回复切开依次发。 */
const TEXT_CHUNK_CHARS = 3_500;
/** 卡片放不下的回复改成文本，避免被钉钉静默截断。 */
const CARD_MAX_CHARS = 6_000;

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
};

export class Bridge {
  private readonly store: ConfigStore;
  private readonly host: ServiceHost;
  private readonly dataDir: string;
  private readonly log: (message: string) => void;
  private readonly onStateChange: () => void;
  private readonly api: DingTalkApi;
  private readonly pendings: Pending[] = [];
  private readonly cards = new Map<string, CardSlot>();
  private readonly refusals = new Map<string, number>();
  private lastInbound: { target: ReplyTarget; at: number } | null = null;
  private tail: Promise<void> = Promise.resolve();
  /** 每个会话的回合代号：收尾时加一，正在建的卡片就会作废。 */
  private readonly epochs = new Map<string, number>();

  constructor(deps: BridgeDeps) {
    this.store = deps.store;
    this.host = deps.host;
    this.dataDir = deps.dataDir;
    this.log = deps.log;
    this.onStateChange = deps.onStateChange;
    this.api = deps.api ?? createDingTalkApi({ logger: console });
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

    const text = message.text?.trim() ?? '';
    await this.store.logActivity('in', text ? `${message.senderNick ?? message.senderId}: ${text}` : `${message.senderNick ?? message.senderId} 发来附件`);
    void this.react(REACTION_THINKING_NAME, message.target.messageId);

    if (text.startsWith('/')) {
      const handled = await this.handleCommand(message, text);
      if (handled) return;
      // 不认识的 /xxx 按原文转给 agent，和原项目一致。
    }

    if (text && this.pendings.length > 0) {
      const answered = await this.answerPending(message, text);
      if (answered) return;
    }

    const prompt = await this.buildPrompt(message);
    if (!prompt) {
      await this.reply(message.target, '这条消息里没有可以转给 agent 的内容。');
      return;
    }
    await this.deliver(message, prompt);
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

  /** 图片/文件先落到本机，prompt 里给出绝对路径。 */
  private async buildPrompt(message: InboundMessage): Promise<string> {
    const lines: string[] = [];
    const text = message.text?.trim() ?? '';
    if (text) lines.push(text);

    if (message.attachment) {
      try {
        const downloaded = await downloadAttachment(this.api, { ...this.credentials, robotCode: this.robotCode, cardTemplateId: '' }, message.attachment, {
          robotCode: this.robotCode,
          maxBytes: ATTACHMENT_MAX_BYTES,
        });
        const dir = path.join(this.dataDir, 'uploads');
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const target = path.join(dir, `${stamp}-${downloaded.fileName}`);
        await writeFile(target, downloaded.bytes, { mode: 0o600 });
        lines.push(
          lines.length > 0 ? '' : '钉钉发来一个附件，已保存到本机：',
          `附件路径：${target}`,
          '需要时请直接读取这个文件。',
        );
        await this.store.logActivity('state', `附件已保存：${downloaded.fileName}`);
      } catch (error) {
        lines.push(`（有一个钉钉附件没能下载：${errorText(error)}）`);
      }
    }

    return lines.join('\n').trim();
  }

  /** 找到（或新建）会话并把 prompt 发过去。 */
  private async deliver(message: InboundMessage, prompt: string): Promise<void> {
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
            `没能把消息送到 OpenChamber：${errorText(error)}\n回复 /new 可以开一个新会话。`,
          );
          return;
        }
        await this.store.setBinding(null);
        this.onStateChange();
      }
    }
    await this.startSession(message, prompt);
  }

  private async startSession(message: InboundMessage, prompt: string): Promise<void> {
    const directory = this.store.settings.directory;
    if (!directory) {
      await this.reply(
        message.target,
        '还差一步：在 OpenChamber 的「钉钉桥接」面板里选择默认项目目录，下一条消息就会开一个新会话。',
      );
      return;
    }
    const title = this.store.value.pendingTitle?.trim() || `钉钉 · ${message.senderNick ?? message.senderId}`;
    try {
      const started = await this.host.sessions.start({ prompt, directory, title });
      const binding: Binding = {
        userId: message.senderId,
        sessionId: started.sessionId,
        directory: started.directory ?? directory,
        title,
        target: message.target,
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
    } catch (error) {
      await this.store.logActivity('error', `新建会话失败：${errorText(error)}`);
      await this.reply(
        message.target,
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

  private async handleCommand(message: InboundMessage, raw: string): Promise<boolean> {
    const [head] = raw.trim().split(/\s+/, 1);
    const name = (head ?? '').toLowerCase();
    const argument = raw.trim().slice(head?.length ?? 0).trim();
    const target = message.target;

    switch (name) {
      case '/help':
      case '/h':
      case '/?': {
        await this.reply(target, HELP_TEXT);
        return true;
      }
      case '/status': {
        await this.reply(target, await this.statusText());
        return true;
      }
      case '/ping': {
        await this.reply(target, '🏓 连接正常。');
        return true;
      }
      case '/id': {
        await this.reply(
          target,
          `你的 staffId：\`${message.senderId}\`\n会话：\`${this.store.binding?.sessionId ?? '（未绑定）'}\``,
        );
        return true;
      }
      case '/new': {
        const previous = this.store.binding;
        await this.closeCards('已切换到新会话，这张卡片结束了。');
        await this.store.setBinding(null);
        await this.store.setPendingTitle(argument || null);
        this.pendings.length = 0;
        this.onStateChange();
        await this.reply(
          target,
          `${previous ? '已解除当前会话，' : ''}下一条消息会新建一个会话${argument ? `（标题：${argument}）` : ''}。`,
        );
        return true;
      }
      case '/sessions': {
        const list = this.store.value.sessions;
        if (list.length === 0) {
          await this.reply(target, '还没有通过钉钉建过会话。');
          return true;
        }
        const current = this.store.binding?.sessionId;
        const lines = list.slice(0, 10).map((entry, index) => {
          const mark = entry.sessionId === current ? ' ✅' : '';
          const title = entry.title || entry.directory || entry.sessionId;
          return `${index + 1}. ${title}${mark}\n   \`${entry.sessionId}\``;
        });
        await this.reply(target, ['最近由钉钉创建的会话：', '', ...lines, '', '/switch 序号 可切回去。'].join('\n'));
        return true;
      }
      case '/switch':
      case '/s': {
        const list = this.store.value.sessions;
        if (!argument) {
          await this.reply(target, '用法：/switch 序号（用 /sessions 看列表）');
          return true;
        }
        const index = Number(argument);
        const entry = Number.isInteger(index) && index >= 1 && index <= list.length
          ? list[index - 1]
          : list.find((item) => item.sessionId === argument);
        if (!entry) {
          await this.reply(target, `没有找到「${argument}」，用 /sessions 看看有哪些。`);
          return true;
        }
        await this.store.setBinding({
          userId: message.senderId,
          sessionId: entry.sessionId,
          directory: entry.directory,
          title: entry.title,
          target,
          boundAt: Date.now(),
        });        await this.store.logActivity('state', `切换会话 ${entry.sessionId}`);
        this.onStateChange();
        await this.reply(target, `已切到「${entry.title || entry.sessionId}」。`);
        return true;
      }
      case '/stop': {
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
      case '/unbind': {
        await this.closeCards('已解除绑定，这张卡片结束了。');
        await this.store.setBinding(null);
        await this.store.setPendingTitle(null);
        this.pendings.length = 0;
        this.onStateChange();
        await this.reply(target, '已解除绑定，下一条消息会开新会话。');
        return true;
      }
      case '/dir': {
        if (!argument) {
          await this.reply(target, `默认项目目录：\`${this.store.settings.directory || '（未设置）'}\``);
          return true;
        }
        await this.store.patchSettings({ directory: argument });
        this.onStateChange();
        await this.reply(target, `已把默认项目目录设为 \`${argument}\`，下一条新会话就用它。`);
        return true;
      }
      case '/notify': {
        const on = argument.toLowerCase();
        if (on !== 'on' && on !== 'off') {
          await this.reply(target, `其它会话的提醒现在是：${this.store.settings.notifyOtherSessions ? '开' : '关'}。用法 /notify on|off`);
          return true;
        }
        await this.store.patchSettings({ notifyOtherSessions: on === 'on' });
        this.onStateChange();
        await this.reply(target, `其它会话结束时推送到钉钉：${on === 'on' ? '已打开' : '已关闭'}。`);
        return true;
      }
      case '/pending':
      case '/rq': {
        const pending = this.pendings[0];
        if (!pending) {
          await this.reply(target, '当前没有等待你回答的请求。');
          return true;
        }
        await this.reply(
          target,
          pending.kind === 'permission'
            ? '还有一条授权请求在等你：回复 1 允许，2 拒绝。'
            : '还有一个提问在等你：按提示回复内容即可。',
        );
        return true;
      }
      default:
        return false;
    }
  }

  private async statusText(): Promise<string> {
    const settings = this.store.settings;
    const binding = this.store.binding;
    const lines = [
      '📋 **钉钉桥接状态**',
      '',
      `凭据：${this.configured ? '已配置' : '未配置'}`,
      `默认目录：\`${settings.directory || '未设置'}\``,
      `其它会话提醒：${settings.notifyOtherSessions ? '开' : '关'}`,
    ];
    if (binding) {
      lines.push(`当前会话：${binding.title || binding.sessionId}`, `\`${binding.sessionId}\``);
      try {
        const status = await this.host.sessions.status(binding.sessionId);
        lines.push(`运行状态：${status.status === 'busy' ? '正在处理' : status.status === 'waiting' ? '等待你回答' : '空闲'}`);
      } catch {
        lines.push('运行状态：会话已不可用，发一条消息会重建');
      }
    } else {
      lines.push('当前会话：未绑定（下一条消息会新建）');
    }
    if (this.pendings.length > 0) {
      lines.push(`等你回答：${this.pendings.length} 个请求`);
    }
    return lines.join('\n');
  }
}

export const HELP_TEXT = [
  '🤖 **钉钉 ⇄ OpenChamber**',
  '',
  '直接发消息就是给 agent 的新指令；图片和文件会存到本机并把路径一起交给 agent。',
  '',
  '**会话**',
  '`/new [标题]` 下一条消息开新会话',
  '`/sessions` 最近由钉钉建过的会话',
  '`/switch 序号` 切回旧会话',
  '`/unbind` 解除绑定',
  '`/stop` 中断当前这一轮',
  '',
  '**运行**',
  '`/status` 绑定、目录、当前状态',
  '`/notify on|off` 其它会话结束时也推到钉钉',
  '`/dir [路径]` 查看或设置默认项目目录',
  '`/pending` 查看等待回答的授权或提问',
  '`/ping` 连通性检查',
  '`/help` 这份说明',
  '',
  '授权请求回复 **1** 允许、**2** 拒绝；提问按提示回复序号或「字段=值」。',
].join('\n');

function cardTarget(target: ReplyTarget) {
  if (target.conversationType === 'group') {
    return { type: 'group' as const, openConversationId: target.openConversationId ?? target.conversationId };
  }
  return { type: 'user' as const, ...(target.userId ? { userId: target.userId } : {}) };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const value = (error as { message?: unknown } | null)?.message;
  return typeof value === 'string' ? value : String(error);
}
