/**
 * DingTalk channel wire types + the bridge's canonical inbound model.
 *
 * Three layers live here on purpose:
 *
 * 1. **Stream frames** — what the long connection delivers (a JSON envelope
 *    per frame, with the robot callback serialised into `data`).
 * 2. **OpenAPI payloads** — the shapes the REST endpoints accept/return.
 * 3. **{@link InboundMessage}** — the channel-neutral message the bridge and
 *    the adapter layer consume. Everything DingTalk-specific is normalised at
 *    the boundary ({@link normalizeRobotCallback}) so the remaining 7k lines
 *    of bridge logic never touch a DingTalk field name.
 */

/** Robot-message callback topic (the bot's inbound message stream). */
export const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";
/** AI card callback topic. */
export const TOPIC_CARD = "/v1.0/card/instances/callback";

/** OpenAPI host for token / robot / card / media endpoints. */
export const DINGTALK_API_BASE = "https://api.dingtalk.com";
/** Legacy OAPI host (multipart media upload). */
export const DINGTALK_OAPI_BASE = "https://oapi.dingtalk.com";

/**
 * Public "AI card" template shipped with DingTalk's robot samples.
 *
 * The card template decides the visual layout; the robot only pushes the
 * `msgContent` field into it. Operators with their own template can override
 * this from the settings page ({@link DingTalkCredentials.cardTemplateId}).
 */
export const DEFAULT_CARD_TEMPLATE_ID = "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema";

/** Flow states baked into the card template's `flowStatus` parameter. */
export const CARD_FLOW_PROCESSING = "2";
export const CARD_FLOW_FINISHED = "3";
export const CARD_FLOW_FAILED = "5";

/** Text/emoji reaction used as the "thinking" indicator. */
export const REACTION_THINKING_NAME = "🤔思考中";
export const REACTION_DONE_NAME = "✅已完成";
export const REACTION_TEXT_EMOTION_ID = "2659900";
export const REACTION_TEXT_BACKGROUND_ID = "im_bg_1";

// ─── Credentials ───────────────────────────────────────────────────────

/** DingTalk app credentials + the robot the plugin acts as. */
export interface DingTalkCredentials {
  /** AppKey / Client ID of the internal app. */
  clientId: string;
  /** AppSecret / Client Secret. Never logged, never returned by the API. */
  clientSecret: string;
  /** Robot code; defaults to {@link clientId} when the console leaves it blank. */
  robotCode: string;
  /** AI card template id; defaults to {@link DEFAULT_CARD_TEMPLATE_ID}. */
  cardTemplateId: string;
}

// ─── Stream frames ─────────────────────────────────────────────────────

/** One frame pushed by the DingTalk stream gateway. */
export interface StreamFrame {
  type?: string;
  headers?: {
    topic?: string;
    messageId?: string;
    contentType?: string;
    [key: string]: unknown;
  };
  data?: string;
  [key: string]: unknown;
}

// ─── Robot callback ────────────────────────────────────────────────────

/** Media/file payload attached to a robot callback (`content` field). */
export interface RobotCallbackContent {
  downloadCode?: string;
  pictureDownloadCode?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  recognition?: string;
  richText?: Array<{ text?: string; type?: string; downloadCode?: string }>;
  [key: string]: unknown;
}

/**
 * The JSON body DingTalk posts to the robot topic.
 *
 * Field names are DingTalk's own (camelCase); nothing outside this module and
 * {@link normalizeRobotCallback} should read them.
 */
export interface RobotCallback {
  msgId?: string;
  createAt?: number;
  conversationId?: string;
  conversationType?: string;
  conversationTitle?: string;
  senderId?: string;
  senderStaffId?: string;
  senderNick?: string;
  senderCorpId?: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  robotCode?: string;
  msgtype?: string;
  text?: { content?: string };
  content?: RobotCallbackContent;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  isAdmin?: boolean;
  isInAtList?: boolean;
  atUsers?: Array<{ dingtalkId?: string; staffId?: string }>;
  [key: string]: unknown;
}

// ─── Canonical inbound model ───────────────────────────────────────────

export type AttachmentKind = "image" | "file" | "audio" | "video";

/** One inbound attachment, still remote (downloaded lazily by the adapter). */
export interface InboundAttachment {
  kind: AttachmentKind;
  /** Opaque handle redeemed for a download URL. */
  downloadCode: string;
  fileName?: string;
  sizeBytes?: number;
  /** Voice-to-text result, when DingTalk already transcribed the audio. */
  transcript?: string;
}

/** Where a reply to this message goes. */
export interface ReplyTarget {
  /** 1:1 robot conversation. */
  conversationType: "single" | "group";
  conversationId: string;
  /** The inbound `msgId` — the target of emoji reactions. */
  messageId?: string;
  /** Staff id used for proactive pushes (`oToMessages/batchSend`). */
  userId?: string;
  /** Group conversation id used for proactive pushes. */
  openConversationId?: string;
  /** Per-message reply webhook (valid ~1.5h). */
  sessionWebhook?: string;
  sessionWebhookExpiresAt?: number;
}

/** The channel-neutral message every other module sees. */
export interface InboundMessage {
  /** DingTalk `msgId` — the de-dupe key. */
  id: string;
  /** Staff id of the sender (falls back to the opaque `senderId`). */
  senderId: string;
  senderNick?: string;
  createdAt: number;
  /** Plain text body, already trimmed and with the bot mention removed. */
  text?: string;
  attachment?: InboundAttachment;
  target: ReplyTarget;
  /** Original callback, kept for logging/audit only. */
  raw?: RobotCallback;
}

// ─── Outbound targets ──────────────────────────────────────────────────

/** A recipient for a proactive (non-webhook) send. */
export type OutboundTarget =
  | { type: "user"; userId: string; robotCode: string }
  | { type: "group"; openConversationId: string; robotCode: string };

/** Split a long DingTalk text body on a code-fence/paragraph boundary. */
export function splitDingTalkText(value: string, maxChars = 4_000): string[] {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return [];
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new TypeError("maxChars must be a positive integer");
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * DingTalk markdown renders hard line breaks as plain spaces inside a card,
 * so every line break that is NOT inside a fenced code block is turned into
 * an explicit `<br>`. Mirrors the rendering rule the reference project uses.
 */
export function normalizeCardMarkdown(value: string): string {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  const lines = text.split("\n");
  let inCodeBlock = false;
  return lines
    .map((line, index) => {
      const fenced = /^\s{0,3}```/.test(line);
      const currentInCodeBlock = inCodeBlock;
      if (fenced) inCodeBlock = !inCodeBlock;
      if (index === lines.length - 1) return line;
      if (currentInCodeBlock || fenced || inCodeBlock || !line || !lines[index + 1]) return `${line}\n`;
      if (/^\s{0,3}(?:[-*+] |\d+[.)] |#{1,6} |\||> )/.test(lines[index + 1] ?? "")) return `${line}\n`;
      return `${line}<br>`;
    })
    .join("");
}

/**
 * Normalise one robot callback into {@link InboundMessage}.
 *
 * Returns `undefined` for callbacks the bridge cannot act on (no id, no
 * sender, unsupported `msgtype`) — the stream still acknowledges them so
 * DingTalk does not retry.
 */
export function normalizeRobotCallback(payload: unknown): InboundMessage | undefined {
  const raw = payload as RobotCallback | undefined;
  if (!raw || typeof raw !== "object") return undefined;

  const id = nonEmpty(raw.msgId) ?? nonEmpty((raw as Record<string, unknown>).conversationId as string ?? "");
  const senderId = nonEmpty(raw.senderStaffId) ?? nonEmpty(raw.senderId);
  if (!id || !senderId) return undefined;

  const conversationType = raw.conversationType === "2" ? "group" : "single";
  const target: ReplyTarget = {
    conversationType,
    conversationId: nonEmpty(raw.conversationId) ?? "",
    messageId: id,
    ...(nonEmpty(raw.senderStaffId) ? { userId: nonEmpty(raw.senderStaffId) } : {}),
    ...(conversationType === "group" && nonEmpty(raw.conversationId)
      ? { openConversationId: nonEmpty(raw.conversationId) }
      : {}),
    ...(nonEmpty(raw.sessionWebhook) ? { sessionWebhook: nonEmpty(raw.sessionWebhook) } : {}),
    ...(typeof raw.sessionWebhookExpiredTime === "number"
      ? { sessionWebhookExpiresAt: raw.sessionWebhookExpiredTime }
      : {}),
  };

  const { text, attachment } = extractBody(raw);
  return {
    id,
    senderId,
    ...(nonEmpty(raw.senderNick) ? { senderNick: nonEmpty(raw.senderNick) } : {}),
    createdAt: typeof raw.createAt === "number" && Number.isFinite(raw.createAt) ? raw.createAt : Date.now(),
    ...(text ? { text } : {}),
    ...(attachment ? { attachment } : {}),
    target,
    raw,
  };
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Strip the leading bot mention DingTalk prepends in group chats. */
function stripMention(text: string): string {
  return text.replace(/^@\S+\s+/u, "").trim();
}

function extractBody(raw: RobotCallback): { text?: string; attachment?: InboundAttachment } {
  const msgtype = nonEmpty(raw.msgtype) ?? "";
  const content = raw.content ?? {};

  if (msgtype === "text") {
    const text = nonEmpty(raw.text?.content);
    return text ? { text: stripMention(text) } : {};
  }

  if (msgtype === "richText") {
    const parts: string[] = [];
    let attachment: InboundAttachment | undefined;
    for (const piece of content.richText ?? []) {
      const pieceText = nonEmpty(piece?.text);
      if (pieceText) parts.push(pieceText);
      const code = nonEmpty(piece?.downloadCode);
      if (code && !attachment) {
        attachment = { kind: piece?.type === "picture" ? "image" : "file", downloadCode: code };
      }
    }
    const text = stripMention(parts.join("\n"));
    return {
      ...(text ? { text } : {}),
      ...(attachment ? { attachment } : {}),
    };
  }

  if (msgtype === "picture") {
    const code = nonEmpty(content.downloadCode) ?? nonEmpty(content.pictureDownloadCode);
    return code ? { attachment: { kind: "image", downloadCode: code } } : {};
  }

  if (msgtype === "file") {
    const code = nonEmpty(content.downloadCode);
    return code
      ? {
        attachment: {
          kind: "file",
          downloadCode: code,
          ...(nonEmpty(content.fileName) ? { fileName: nonEmpty(content.fileName) } : {}),
          ...(typeof content.fileSize === "number" ? { sizeBytes: content.fileSize } : {}),
        },
      }
      : {};
  }

  if (msgtype === "audio" || msgtype === "voice") {
    // DingTalk transcribes voice notes server-side; the transcript is the
    // useful payload, the audio itself is only delivered when it is missing.
    const transcript = nonEmpty(content.recognition);
    const code = nonEmpty(content.downloadCode);
    if (transcript) return { text: transcript };
    return code ? { attachment: { kind: "audio", downloadCode: code } } : {};
  }

  if (msgtype === "video") {
    const code = nonEmpty(content.downloadCode);
    return code ? { attachment: { kind: "video", downloadCode: code } } : {};
  }

  return {};
}