/**
 * DingTalk OpenAPI client: access token, robot text/file/image delivery,
 * inbound attachment download, AI card streaming and message reactions.
 *
 * Endpoints used (all verified against the reference implementation
 * https://github.com/xmanrui/dsh-im):
 *
 *   POST /v1.0/oauth2/accessToken          — app access token (cached)
 *   POST <sessionWebhook>                  — reply to the inbound message
 *   POST /v1.0/robot/oToMessages/batchSend — proactive 1:1 push
 *   POST /v1.0/robot/groupMessages/send    — proactive group push
 *   POST /media/upload (oapi)              — file/image upload → media_id
 *   POST /v1.0/robot/messageFiles/download — inbound attachment URL
 *   POST /v1.0/card/instances/createAndDeliver — AI card creation
 *   PUT  /v1.0/card/streaming              — AI card update / finalise
 *   PUT  /v1.0/card/instances              — AI card template state
 *   POST /v1.0/robot/emotion/reply|recall  — 🤔/✅ message reactions
 */

import { randomUUID } from "node:crypto";
import {
  CARD_FLOW_FAILED,
  CARD_FLOW_FINISHED,
  CARD_FLOW_PROCESSING,
  DEFAULT_CARD_TEMPLATE_ID,
  DINGTALK_API_BASE,
  DINGTALK_OAPI_BASE,
  REACTION_TEXT_BACKGROUND_ID,
  REACTION_TEXT_EMOTION_ID,
  normalizeCardMarkdown,
  type DingTalkCredentials,
  type OutboundTarget,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const REACTION_TIMEOUT_MS = 5_000;
/** Minimum spacing between two card calls (DingTalk rate-limits the card API). */
const CARD_MIN_INTERVAL_MS = 50;
/** One retry after a 403: the card API rejects a burst with 403 before it settles. */
const CARD_BACKOFF_MS = 1_000;

export type DingTalkApiErrorCode =
  | "http-error"
  | "timeout"
  | "network-error"
  | "invalid-response"
  | "invalid-access-token"
  | "send-rejected"
  | "upload-rejected"
  | "download-failed"
  | "invalid-target"
  | "invalid-session-webhook";

/** Typed failure; `code` is the plugin's own vocabulary, `providerCode` DingTalk's. */
export class DingTalkApiError extends Error {
  readonly code: DingTalkApiErrorCode;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    code: DingTalkApiErrorCode,
    message: string,
    options: { cause?: unknown; status?: number; providerCode?: string } = {},
  ) {
    super(message);
    this.name = "DingTalkApiError";
    this.code = code;
    this.status = options.status;
    this.providerCode = options.providerCode;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** The app credentials are wrong or expired: retrying cannot help. */
export function isAuthError(error: unknown): boolean {
  if (!(error instanceof DingTalkApiError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return error.providerCode === "InvalidAuthentication"
    || error.providerCode === "Forbidden.AccessDenied.AccessTokenPermissionDenied"
    || error.providerCode === "invalid_app_key_or_app_secret";
}

/** The target/format was refused (bad userId, unsupported msgtype, …). */
export function isRejectedError(error: unknown): boolean {
  if (!(error instanceof DingTalkApiError)) return false;
  if (error.code === "send-rejected" || error.code === "upload-rejected" || error.code === "invalid-target") return true;
  return error.status === 400 || error.status === 404 || error.status === 422;
}

/** Rate limiting — worth queueing and retrying later. */
export function isRateLimitError(error: unknown): boolean {
  return error instanceof DingTalkApiError && (error.status === 429 || error.providerCode === "Throttling");
}

/** Transport-level hiccup: the send may or may not have landed. */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof DingTalkApiError)) return false;
  if (error.code === "timeout" || error.code === "network-error" || error.code === "invalid-response") return true;
  return typeof error.status === "number" && error.status >= 500;
}

export interface ApiOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, "warn">;
  apiBase?: string;
  oapiBase?: string;
  cardMinIntervalMs?: number;
}

export interface SendTextOptions {
  credentials: Pick<DingTalkCredentials, "clientId" | "clientSecret">;
  signal?: AbortSignal;
}

export interface ReplyOptions extends SendTextOptions {
  sessionWebhook: string;
  text: string;
  /** Render as DingTalk markdown instead of plain text. */
  markdown?: boolean;
  atUserIds?: string[];
}

export interface RobotTextOptions extends SendTextOptions {
  target: OutboundTarget;
  text: string;
  markdown?: boolean;
}

export interface SendArtifactOptions extends SendTextOptions {
  target: OutboundTarget;
  fileName: string;
  bytes: Buffer;
  mediaType?: string;
}

export interface DownloadOptions extends SendTextOptions {
  downloadCode: string;
}

export interface CardTarget {
  type: "user" | "group";
  userId?: string;
  openConversationId?: string;
  atUserIds?: Record<string, string>;
}

export interface AiCardOptions extends SendTextOptions {
  target: CardTarget;
  robotCode: string;
  cardTemplateId?: string;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  action?: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isDingTalkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "dingtalk.com" || host.endsWith(".dingtalk.com");
}

/** A session webhook comes from the remote payload: never POST it unchecked. */
export function normalizeSessionWebhook(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DingTalkApiError("invalid-session-webhook", "钉钉回复地址无效。");
  }
  if (url.protocol !== "https:" || !isDingTalkHost(url.hostname) || url.username || url.password) {
    throw new DingTalkApiError("invalid-session-webhook", "钉钉回复地址不受信任。");
  }
  url.hash = "";
  return url.toString();
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    // NOT unref'd: this is the card pacing/backoff wait, and a pending card
    // update is real work. An unref'd timer here lets an otherwise idle
    // process exit with the update still queued.
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal ? abortError(signal) : new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Normalise the card target, rejecting shapes DingTalk cannot deliver to. */
function normalizeCardTarget(target: CardTarget, robotCode: string): Required<Pick<CardTarget, "type">> & CardTarget & { robotCode: string } {
  if (target?.type === "group") {
    const openConversationId = nonEmpty(target.openConversationId);
    if (!openConversationId) throw new DingTalkApiError("invalid-target", "钉钉群会话 id 缺失。");
    return { type: "group", openConversationId, robotCode };
  }
  const userId = nonEmpty(target?.userId);
  if (!userId) throw new DingTalkApiError("invalid-target", "钉钉用户 id 缺失。");
  return { type: "user", userId, robotCode };
}

function cardDeliverBody(cardInstanceId: string, target: ReturnType<typeof normalizeCardTarget>): Record<string, unknown> {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };
  if (target.type === "group") {
    return {
      ...base,
      openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId ?? ""}`,
      imGroupOpenDeliverModel: { robotCode: target.robotCode, atUserIds: target.atUserIds },
    };
  }
  return {
    ...base,
    openSpaceId: `dtv1.card//IM_ROBOT.${target.userId ?? ""}`,
    imRobotOpenDeliverModel: {
      spaceType: "IM_ROBOT",
      robotCode: target.robotCode,
      extension: { dynamicSummary: "true" },
    },
  };
}

function cardData(text: string, flowStatus: string): Record<string, unknown> {
  const markdown = normalizeCardMarkdown(text);
  return {
    cardParamMap: {
      flowStatus,
      msgContent: markdown,
      staticMsgContent: "",
      sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }),
      config: JSON.stringify({ autoLayout: true }),
    },
  };
}

/** A rejected-but-200 response (`errcode`/`code` in the body). */
function rejectedProviderResponse(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const field of ["errcode", "code"]) {
    const fieldValue = record[field];
    if (fieldValue !== undefined && fieldValue !== 0 && fieldValue !== "0") {
      return typeof fieldValue === "string" || typeof fieldValue === "number" ? String(fieldValue) : "rejected";
    }
  }
  return undefined;
}

export function createDingTalkApi(options: ApiOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? console;
  const apiBase = (options.apiBase ?? DINGTALK_API_BASE).replace(/\/+$/, "");
  const oapiBase = (options.oapiBase ?? DINGTALK_OAPI_BASE).replace(/\/+$/, "");
  const cardMinIntervalMs = options.cardMinIntervalMs ?? CARD_MIN_INTERVAL_MS;

  const tokenCache = new Map<string, { token: string; expiresAt: number }>();
  const tokenRequests = new Map<string, Promise<string>>();
  let nextCardRequestAt = 0;
  let cardSlotTail: Promise<void> = Promise.resolve();

  async function requestJson(url: string, opts: RequestOptions = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const { signal } = opts;
    let timedOut = false;
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) throw abortError(signal);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetchImpl(url, {
        method: opts.method ?? "POST",
        redirect: "error",
        headers: { "content-type": "application/json", ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let providerCode: string | undefined;
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          providerCode = nonEmpty(errorBody.code) ?? nonEmpty(errorBody.errcode);
        } catch {
          // DingTalk sometimes returns an empty error body.
        }
        throw new DingTalkApiError(
          "http-error",
          `钉钉服务请求失败（HTTP ${response.status}）。`,
          { status: response.status, ...(providerCode ? { providerCode } : {}) },
        );
      }
      try {
        return (await response.json()) as Record<string, unknown>;
      } catch (error) {
        throw new DingTalkApiError("invalid-response", "钉钉服务返回了无法解析的响应。", { cause: error });
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (timedOut) throw new DingTalkApiError("timeout", "钉钉服务请求超时。", { cause: error });
      if (error instanceof DingTalkApiError) throw error;
      throw new DingTalkApiError("network-error", `暂时无法完成钉钉${opts.action ?? "请求"}。`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function requestMultipart(url: URL | string, body: FormData, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) throw abortError(signal);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPLOAD_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        body,
        signal: controller.signal,
        redirect: "error",
      });
      let value: Record<string, unknown> = {};
      let parseError: unknown;
      try {
        value = (await response.json()) as Record<string, unknown>;
      } catch (error) {
        parseError = error;
      }
      if (!response.ok) {
        const providerCode = nonEmpty(value.code) ?? nonEmpty(value.errcode);
        throw new DingTalkApiError(
          "http-error",
          `钉钉上传失败（HTTP ${response.status}）。`,
          { status: response.status, ...(providerCode ? { providerCode } : {}) },
        );
      }
      if (parseError) {
        throw new DingTalkApiError("invalid-response", "钉钉上传返回了无法解析的响应。", { cause: parseError });
      }
      return value;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (timedOut) throw new DingTalkApiError("timeout", "钉钉上传超时。", { cause: error });
      if (error instanceof DingTalkApiError) throw error;
      throw new DingTalkApiError("network-error", "暂时无法完成钉钉上传。", { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** App access token, cached until shortly before it expires. */
  async function accessToken(
    credentials: Pick<DingTalkCredentials, "clientId" | "clientSecret">,
    signal?: AbortSignal,
  ): Promise<string> {
    const appKey = nonEmpty(credentials?.clientId);
    const appSecret = nonEmpty(credentials?.clientSecret);
    if (!appKey || !appSecret) throw new DingTalkApiError("invalid-access-token", "钉钉凭据缺失。");
    const cached = tokenCache.get(appKey);
    if (cached && cached.expiresAt > now()) return cached.token;
    const inflight = tokenRequests.get(appKey);
    if (inflight) return inflight;

    const request = (async () => {
      const value = await requestJson(`${apiBase}/v1.0/oauth2/accessToken`, {
        body: { appKey, appSecret },
        signal,
        action: "鉴权",
      });
      const token = nonEmpty(value.accessToken);
      if (!token) throw new DingTalkApiError("invalid-access-token", "钉钉服务没有返回访问令牌。");
      const expireIn = Number(value.expireIn ?? value.expiresIn);
      const lifetimeMs = Number.isFinite(expireIn) && expireIn > 0 ? (expireIn - 60) * 1000 : 7_000_000;
      tokenCache.set(appKey, { token, expiresAt: now() + Math.max(1_000, lifetimeMs) });
      return token;
    })();
    const shared = request.finally(() => tokenRequests.delete(appKey));
    tokenRequests.set(appKey, shared);
    return shared;
  }

  async function cardRequest(pathname: string, opts: RequestOptions): Promise<Record<string, unknown>> {
    // Serialise card calls with a minimum spacing: the AI card API 403s a
    // burst, and a 403 there loses a streaming update the user is watching.
    const acquire = async (): Promise<void> => {
      const waitMs = Math.max(0, nextCardRequestAt - now());
      if (waitMs > 0) await delay(waitMs, opts.signal);
      nextCardRequestAt = Math.max(nextCardRequestAt, now()) + cardMinIntervalMs;
    };
    const slot = cardSlotTail.then(acquire, acquire);
    cardSlotTail = slot.catch(() => undefined);
    await slot;
    try {
      return await requestJson(`${apiBase}/${pathname}`, opts);
    } catch (error) {
      if (!(error instanceof DingTalkApiError) || error.status !== 403) throw error;
      await delay(CARD_BACKOFF_MS, opts.signal);
      return requestJson(`${apiBase}/${pathname}`, opts);
    }
  }

  /** Reply to the inbound message through its session webhook. */
  async function sendSessionText(opts: ReplyOptions): Promise<void> {
    const content = nonEmpty(opts.text);
    if (!content) throw new TypeError("text is required");
    const webhook = normalizeSessionWebhook(opts.sessionWebhook);
    const token = await accessToken(opts.credentials, opts.signal);
    const body = opts.markdown
      ? { msgtype: "markdown", markdown: { title: "OpenChamber", text: content } }
      : { msgtype: "text", text: { content } };
    const response = await requestJson(webhook, {
      body: {
        ...body,
        ...(opts.atUserIds && opts.atUserIds.length > 0 ? { at: { atUserIds: opts.atUserIds } } : {}),
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "回复消息",
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了回复消息。", { providerCode: rejection });
    }
  }

  /** Proactive push (no webhook needed): 1:1 or group robot message. */
  async function sendRobotText(opts: RobotTextOptions): Promise<void> {
    const content = nonEmpty(opts.text);
    if (!content) throw new TypeError("text is required");
    const token = await accessToken(opts.credentials, opts.signal);
    const pathname = opts.target.type === "group"
      ? "v1.0/robot/groupMessages/send"
      : "v1.0/robot/oToMessages/batchSend";
    const response = await requestJson(`${apiBase}/${pathname}`, {
      body: {
        robotCode: opts.target.robotCode,
        msgKey: opts.markdown ? "sampleMarkdown" : "sampleText",
        msgParam: JSON.stringify(opts.markdown ? { title: "OpenChamber", text: content } : { content }),
        ...(opts.target.type === "group"
          ? { openConversationId: opts.target.openConversationId }
          : { userIds: [opts.target.userId] }),
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "主动文字消息发送",
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了主动文字消息。", { providerCode: rejection });
    }
  }

  /** Upload one buffer and return the DingTalk `media_id`. */
  async function uploadMedia(
    opts: SendTextOptions & { bytes: Buffer; fileName: string; mediaType?: string; uploadType: "file" | "image" },
  ): Promise<string> {
    const token = await accessToken(opts.credentials, opts.signal);
    const url = new URL(`${oapiBase}/media/upload`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("type", opts.uploadType);
    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(opts.bytes)], { type: opts.mediaType ?? "application/octet-stream" }),
      opts.fileName,
    );
    const uploaded = await requestMultipart(url, form, opts.signal);
    const rejection = rejectedProviderResponse(uploaded);
    const mediaId = nonEmpty(uploaded.media_id);
    if (rejection || !mediaId) {
      throw new DingTalkApiError("upload-rejected", "钉钉服务拒绝了文件上传。", {
        ...(rejection ? { providerCode: rejection } : { providerCode: "missing-media-id" }),
      });
    }
    return mediaId;
  }

  async function sendFile(opts: SendArtifactOptions): Promise<void> {
    const mediaId = await uploadMedia({ ...opts, uploadType: "file" });
    const token = await accessToken(opts.credentials, opts.signal);
    const pathname = opts.target.type === "group"
      ? "v1.0/robot/groupMessages/send"
      : "v1.0/robot/oToMessages/batchSend";
    const extension = opts.fileName.includes(".") ? opts.fileName.split(".").pop()?.toLowerCase() ?? "file" : "file";
    const response = await requestJson(`${apiBase}/${pathname}`, {
      body: {
        robotCode: opts.target.robotCode,
        msgKey: "sampleFile",
        msgParam: JSON.stringify({ mediaId, fileName: opts.fileName, fileType: extension }),
        ...(opts.target.type === "group"
          ? { openConversationId: opts.target.openConversationId }
          : { userIds: [opts.target.userId] }),
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "文件消息发送",
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了文件消息。", { providerCode: rejection });
    }
  }

  async function sendImage(opts: SendArtifactOptions): Promise<void> {
    const mediaId = await uploadMedia({ ...opts, uploadType: "image" });
    const token = await accessToken(opts.credentials, opts.signal);
    const pathname = opts.target.type === "group"
      ? "v1.0/robot/groupMessages/send"
      : "v1.0/robot/oToMessages/batchSend";
    const response = await requestJson(`${apiBase}/${pathname}`, {
      body: {
        robotCode: opts.target.robotCode,
        msgKey: "sampleImageMsg",
        msgParam: JSON.stringify({ photoURL: mediaId }),
        ...(opts.target.type === "group"
          ? { openConversationId: opts.target.openConversationId }
          : { userIds: [opts.target.userId] }),
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "图片消息发送",
    });
    const rejection = rejectedProviderResponse(response);
    if (rejection) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了图片消息。", { providerCode: rejection });
    }
  }

  /** Redeem a `downloadCode` for the (short-lived) signed download URL. */
  async function resolveDownloadUrl(opts: DownloadOptions & { robotCode: string }): Promise<URL> {
    const token = await accessToken(opts.credentials, opts.signal);
    const response = await requestJson(`${apiBase}/v1.0/robot/messageFiles/download`, {
      body: { downloadCode: opts.downloadCode, robotCode: opts.robotCode },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "附件下载地址",
    });
    const raw = nonEmpty(response.downloadUrl);
    if (!raw) throw new DingTalkApiError("download-failed", "钉钉服务没有返回附件下载地址。");
    let url: URL;
    try {
      url = new URL(raw);
    } catch (error) {
      throw new DingTalkApiError("download-failed", "钉钉服务返回了无效的附件下载地址。", { cause: error });
    }
    if (url.protocol === "http:" && (!url.port || url.port === "80")) {
      url.protocol = "https:";
      url.port = "";
    }
    if (url.protocol !== "https:") {
      throw new DingTalkApiError("download-failed", "钉钉附件下载地址不受信任。");
    }
    return url;
  }

  /** Download an inbound attachment into memory (bounded by `maxBytes`). */
  async function downloadAttachment(
    opts: DownloadOptions & { robotCode: string; maxBytes?: number },
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const url = await resolveDownloadUrl(opts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = (): void => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new DingTalkApiError("download-failed", `钉钉附件下载失败（HTTP ${response.status}）。`, {
          status: response.status,
        });
      }
      const length = Number(response.headers.get("content-length"));
      if (opts.maxBytes !== undefined && Number.isFinite(length) && length > opts.maxBytes) {
        throw new DingTalkApiError("download-failed", `钉钉附件超过 ${opts.maxBytes} 字节上限。`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (opts.maxBytes !== undefined && bytes.length > opts.maxBytes) {
        throw new DingTalkApiError("download-failed", `钉钉附件超过 ${opts.maxBytes} 字节上限。`);
      }
      return {
        bytes,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    } catch (error) {
      if (error instanceof DingTalkApiError) throw error;
      throw new DingTalkApiError("download-failed", "钉钉附件下载失败。", { cause: error });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Create + deliver one AI card, returning its instance id. */
  async function createAiCard(
    opts: AiCardOptions & { text: string },
  ): Promise<{ cardInstanceId: string }> {
    const content = nonEmpty(opts.text);
    if (!content) throw new TypeError("text is required");
    const target = normalizeCardTarget(opts.target, opts.robotCode);
    const token = await accessToken(opts.credentials, opts.signal);
    const cardInstanceId = `oc_${randomUUID()}`;
    const headers = { "x-acs-dingtalk-access-token": token };
    const cardTemplateId = nonEmpty(opts.cardTemplateId) ?? DEFAULT_CARD_TEMPLATE_ID;
    try {
      await cardRequest("v1.0/card/instances/createAndDeliver", {
        body: {
          ...cardDeliverBody(cardInstanceId, target),
          cardTemplateId,
          outTrackId: cardInstanceId,
          cardData: cardData(content, CARD_FLOW_PROCESSING),
          callbackType: "STREAM",
          ...(target.type === "group" && target.atUserIds
            ? { cardAtUserIds: Object.keys(target.atUserIds) }
            : {}),
          ...(target.type === "group"
            ? { imGroupOpenSpaceModel: { supportForward: true } }
            : { imRobotOpenSpaceModel: { supportForward: true } }),
        },
        headers,
        signal: opts.signal,
        action: "AI 卡片创建",
      });
      try {
        await cardRequest("v1.0/card/streaming", {
          method: "PUT",
          body: {
            outTrackId: cardInstanceId,
            guid: randomUUID(),
            key: "msgContent",
            content: normalizeCardMarkdown(content).replace(/\n+$/, ""),
            isFull: true,
            isFinalize: false,
            isError: false,
          },
          headers,
          signal: opts.signal,
          action: "AI 卡片启动",
        });
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        logger.warn("[钉钉] AI 卡片启动时首帧未送达");
      }
    } catch (error) {
      // A card that was delivered but cannot be filled would stay blank; close
      // it so the user sees an explicit terminal state instead of a spinner.
      await failAiCard({
        credentials: opts.credentials,
        robotCode: opts.robotCode,
        cardInstanceId,
        text: "卡片已结束，请查看后续消息。",
        target: opts.target,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
      throw error;
    }
    return { cardInstanceId };
  }

  async function updateAiCard(
    opts: AiCardOptions & { cardInstanceId: string; text: string },
  ): Promise<void> {
    const content = nonEmpty(opts.text);
    if (!content) throw new TypeError("text is required");
    // Validate the target so a malformed route fails here, not on a card that
    // is already visible to the user.
    normalizeCardTarget(opts.target, opts.robotCode);
    const token = await accessToken(opts.credentials, opts.signal);
    await cardRequest("v1.0/card/streaming", {
      method: "PUT",
      body: {
        outTrackId: opts.cardInstanceId,
        guid: randomUUID(),
        key: "msgContent",
        content: normalizeCardMarkdown(content).replace(/\n+$/, ""),
        isFull: true,
        isFinalize: false,
        isError: false,
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      action: "AI 卡片更新",
    });
  }

  async function finishAiCard(
    opts: AiCardOptions & { cardInstanceId: string; text: string },
  ): Promise<void> {
    const content = nonEmpty(opts.text);
    if (!content) throw new TypeError("text is required");
    normalizeCardTarget(opts.target, opts.robotCode);
    const token = await accessToken(opts.credentials, opts.signal);
    const headers = { "x-acs-dingtalk-access-token": token };
    await cardRequest("v1.0/card/streaming", {
      method: "PUT",
      body: {
        outTrackId: opts.cardInstanceId,
        guid: randomUUID(),
        key: "msgContent",
        content: normalizeCardMarkdown(content),
        isFull: true,
        isFinalize: true,
        isError: false,
      },
      headers,
      signal: opts.signal,
      action: "AI 卡片完成",
    });
    await cardRequest("v1.0/card/instances", {
      method: "PUT",
      body: {
        outTrackId: opts.cardInstanceId,
        cardData: cardData(content, CARD_FLOW_FINISHED),
        cardUpdateOptions: { updateCardDataByKey: true },
      },
      headers,
      signal: opts.signal,
      action: "AI 卡片完成状态",
    });
  }

  async function failAiCard(
    opts: AiCardOptions & { cardInstanceId: string; text: string },
  ): Promise<void> {
    const content = nonEmpty(opts.text);
    if (!content) throw new TypeError("text is required");
    const token = await accessToken(opts.credentials, opts.signal);
    const headers = { "x-acs-dingtalk-access-token": token };
    const [streamed] = await Promise.allSettled([
      cardRequest("v1.0/card/streaming", {
        method: "PUT",
        body: {
          outTrackId: opts.cardInstanceId,
          guid: randomUUID(),
          key: "msgContent",
          content: normalizeCardMarkdown(content),
          isFull: true,
          isFinalize: false,
          isError: true,
        },
        headers,
        signal: opts.signal,
        action: "AI 卡片失败收口",
      }),
      cardRequest("v1.0/card/instances", {
        method: "PUT",
        body: {
          outTrackId: opts.cardInstanceId,
          cardData: cardData(content, CARD_FLOW_FAILED),
          cardUpdateOptions: { updateCardDataByKey: true },
        },
        headers,
        signal: opts.signal,
        action: "AI 卡片失败状态",
      }),
    ]);
    if (streamed.status === "rejected") throw streamed.reason;
  }

  /** Toggle a text/emoji reaction on one inbound message. */
  async function changeReaction(
    opts: SendTextOptions & {
      robotCode: string;
      messageId: string;
      conversationId: string;
      reactionName: string;
    },
    action: "reply" | "recall",
  ): Promise<void> {
    const token = await accessToken(opts.credentials, opts.signal);
    const response = await requestJson(`${apiBase}/v1.0/robot/emotion/${action}`, {
      body: {
        robotCode: opts.robotCode,
        openMsgId: opts.messageId,
        openConversationId: opts.conversationId,
        emotionType: 2,
        emotionName: opts.reactionName,
        textEmotion: {
          emotionId: REACTION_TEXT_EMOTION_ID,
          emotionName: opts.reactionName,
          text: opts.reactionName,
          backgroundId: REACTION_TEXT_BACKGROUND_ID,
        },
      },
      headers: { "x-acs-dingtalk-access-token": token },
      signal: opts.signal,
      timeoutMs: REACTION_TIMEOUT_MS,
      action: action === "reply" ? "消息状态添加" : "消息状态撤回",
    });
    const rejected = response.success === false
      ? nonEmpty(response.code) ?? "rejected"
      : rejectedProviderResponse(response);
    if (rejected) {
      throw new DingTalkApiError("send-rejected", "钉钉服务拒绝了消息状态请求。", { providerCode: rejected });
    }
  }

  return {
    accessToken,
    sendSessionText,
    sendRobotText,
    sendFile,
    sendImage,
    uploadMedia,
    resolveDownloadUrl,
    downloadAttachment,
    createAiCard,
    updateAiCard,
    finishAiCard,
    failAiCard,
    addReaction: (
      opts: SendTextOptions & { robotCode: string; messageId: string; conversationId: string; reactionName: string },
    ) => changeReaction(opts, "reply"),
    recallReaction: (
      opts: SendTextOptions & { robotCode: string; messageId: string; conversationId: string; reactionName: string },
    ) => changeReaction(opts, "recall"),
    /** Drop a cached token so the next call re-authenticates (credential change). */
    clearAccessToken(clientId?: string): void {
      if (clientId) tokenCache.delete(clientId);
      else tokenCache.clear();
    },
  };
}

export type DingTalkApi = ReturnType<typeof createDingTalkApi>;