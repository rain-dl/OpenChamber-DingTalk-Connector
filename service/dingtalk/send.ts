/**
 * Outbound facade: one place that decides HOW a message reaches the user.
 *
 * Two transports exist on purpose:
 *
 * - **session webhook** — a per-inbound-message reply URL that needs no
 *   `userId` and is valid for ~1.5h. It is the default reply path: it works
 *   for external contacts that have no staff id.
 * - **robot API** — the proactive path (`oToMessages/batchSend`), used when
 *   the webhook has expired (a delayed answer after a long turn) or when the
 *   bridge pushes something on its own (notifications, `send_dingtalk`).
 *
 * Falling back from one to the other is built in, so a loop that keeps a
 * session alive for hours never loses a message to an expired webhook.
 */

import { isAuthError, isRateLimitError, isTransientError, type DingTalkApi } from "./api.js";
import {
  splitDingTalkText,
  type DingTalkCredentials,
  type OutboundTarget,
  type ReplyTarget,
} from "./types.js";

/** Everything a send needs: the API client, the credentials, and the route. */
export interface SendContext {
  api: DingTalkApi;
  credentials: DingTalkCredentials;
  robotCode: string;
  /** Reply webhook captured from the latest inbound message. */
  target?: ReplyTarget;
  /** Extension point / test seam. */
  signal?: AbortSignal;
  /** Render markdown (robot API) instead of plain text. */
  markdown?: boolean;
}

const WEBHOOK_EXPIRY_SLACK_MS = 10_000;

function webhookUsable(target: ReplyTarget | undefined, now = Date.now()): target is ReplyTarget & { sessionWebhook: string } {
  if (!target?.sessionWebhook) return false;
  if (typeof target.sessionWebhookExpiresAt !== "number") return true;
  return target.sessionWebhookExpiresAt - WEBHOOK_EXPIRY_SLACK_MS > now;
}

function proactiveTarget(ctx: SendContext): OutboundTarget | undefined {
  const target = ctx.target;
  if (!target) return undefined;
  if (target.conversationType === "group") {
    const openConversationId = target.openConversationId ?? target.conversationId;
    return openConversationId ? { type: "group", openConversationId, robotCode: ctx.robotCode } : undefined;
  }
  return target.userId ? { type: "user", userId: target.userId, robotCode: ctx.robotCode } : undefined;
}

/** Split a formatted reply into DingTalk-sized text chunks. */
export function splitText(text: string, limit: number): string[] {
  return splitDingTalkText(text, limit);
}

/**
 * Send one text message. Throws only when BOTH routes are unavailable or
 * refused — a webhook that expired *during* the call is retried over the
 * robot API, which is the normal case for a long turn.
 */
export async function sendTextMessage(text: string, ctx: SendContext): Promise<void> {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) return;
  const target = ctx.target;

  if (webhookUsable(target)) {
    try {
      await ctx.api.sendSessionText({
        credentials: ctx.credentials,
        sessionWebhook: target.sessionWebhook,
        text: body,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      return;
    } catch (error) {
      const proactive = proactiveTarget(ctx);
      if (!proactive) throw error;
      // An expired or malformed webhook is expected after a long turn, and is
      // the whole reason the robot API exists as a second route. Auth errors
      // and rate limits are NOT route-specific, so they are rethrown instead
      // of being retried over a second API.
      if (isAuthError(error) || isRateLimitError(error) || isTransientError(error)) throw error;
    }
  }

  const proactive = proactiveTarget(ctx);
  if (!proactive) {
    throw new Error("钉钉回复目标缺失（webhook 已过期且没有可用的用户 id）");
  }
  await ctx.api.sendRobotText({
    credentials: ctx.credentials,
    target: proactive,
    text: body,
    ...(ctx.markdown ? { markdown: true } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
}

/** Send one attachment: images render inline, everything else is a file card. */
export async function sendMediaMessage(
  kind: "image" | "file" | "video" | "audio",
  bytes: Buffer,
  fileName: string,
  ctx: SendContext,
): Promise<void> {
  const proactive = proactiveTarget(ctx);
  if (!proactive) {
    throw new Error("钉钉发送附件需要用户 id（会话 webhook 不支持附件）");
  }
  if (kind === "image") {
    await ctx.api.sendImage({
      credentials: ctx.credentials,
      target: proactive,
      fileName,
      bytes,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return;
  }
  // Video/audio have no first-class robot message: DingTalk only offers a
  // generic file card, which still plays from the client's preview.
  await ctx.api.sendFile({
    credentials: ctx.credentials,
    target: proactive,
    fileName,
    bytes,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
}

export { isAuthError, isRateLimitError, isRejectedError, isTransientError, DingTalkApiError } from "./api.js";