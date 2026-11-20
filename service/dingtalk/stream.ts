/**
 * DingTalk Stream Mode client (the replacement for the previous channel's
 * long-poll loop).
 *
 * Protocol (verified against the official `dingtalk-stream@2.1.4` SDK): the
 * plugin first opens a connection ticket over HTTPS, then keeps one WebSocket
 * open. DingTalk pushes a JSON envelope per frame:
 *
 *   SYSTEM   CONNECTED / REGISTERED / KEEPALIVE / ping / disconnect
 *   CALLBACK <topic>, <messageId> — the robot message (or card callback)
 *
 * Every callback MUST be acknowledged with its `messageId` within ~60s, or
 * DingTalk redelivers it. The ack is sent before the payload is processed, so
 * a slow turn never causes a duplicate user message; the message id is also
 * de-duplicated locally as a second line of defence.
 *
 * Reconnects are automatic with capped exponential backoff: the ticket is
 * single-use, so a reconnect always re-runs the gateway handshake.
 */

import WebSocket from "ws";

import { TOPIC_CARD, TOPIC_ROBOT, type RobotCallback, type StreamFrame } from "./types.js";

const DEFAULT_API_BASE = "https://api.dingtalk.com";
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const DEDUPE_TTL_MS = 5 * 60_000;
const DEDUPE_CAP = 512;

export type StreamState = "idle" | "connecting" | "connected" | "reconnecting" | "stopped" | "failed";

export interface StreamStatus {
  state: StreamState;
  connected: boolean;
  /**
   * The gateway acknowledged our subscriptions (SYSTEM topic `REGISTERED`).
   * A socket can be open while registration never happens — the common cause
   * of "connected but no messages".
   */
  registered: boolean;
  /** Callbacks delivered to the bridge (deduplicated). */
  messagesReceived: number;
  /** Redeliveries dropped by the message-id guard. */
  duplicatesDropped: number;
  /** Frames seen per class; all zero means the server is silent. */
  frames: { system: number; callback: number; event: number; other: number };
  lastConnectedAt: string | null;
  lastCallbackAt: string | null;
  lastFrameAt: string | null;
  /** Topic of the most recent frame (e.g. `ping`, `/v1.0/im/bot/messages/get`). */
  lastTopic: string | null;
  lastError: string | null;
  reconnectAttempts: number;
}

export interface StreamTransportOptions {
  credentials: { clientId: string; clientSecret: string };
  /** Robot messages (already parsed). */
  onMessage: (payload: RobotCallback) => void;
  /** AI card callbacks; optional because the plugin does not use card buttons. */
  onCardCallback?: (payload: unknown) => void;
  logger?: Pick<Console, "log" | "warn" | "error">;
  signal?: AbortSignal;
  apiBase?: string;
  heartbeatIntervalMs?: number;
  connectTimeoutMs?: number;
  /** Test seam: replace the WebSocket constructor. */
  webSocketImpl?: typeof WebSocket;
  /**
   * State transition sink. The bridge uses it to park / flush outbound around
   * a drop, so a socket that dies mid-life is not invisible to the queue.
   */
  onStateChange?: (status: StreamStatus) => void;
  /**
   * Per-frame diagnostic sink. Receives a SANITIZED descriptor (frame type,
   * topic, message id and which robot fields are present) — never message
   * content — so a "connected but silent" report can be diagnosed from a log
   * file instead of guesswork.
   */
  onFrame?: (frame: FrameDiagnostic) => void;
}

/** One sanitized frame descriptor (no message body, no credentials). */
export interface FrameDiagnostic {
  type: string;
  topic: string | null;
  messageId?: string;
  /** Present for CALLBACK frames: which fields the payload carried. */
  payload?: {
    keys: string[];
    msgtype?: string;
    conversationType?: string;
    hasMsgId: boolean;
    hasSenderStaffId: boolean;
    hasSenderId: boolean;
    hasText: boolean;
  };
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function reconnectDelay(attempt: number): number {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}

export class DingTalkStream {
  private readonly options: StreamTransportOptions;
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  private readonly WebSocketImpl: typeof WebSocket;
  private socket: WebSocket | null = null;
  private stopped = false;
  private state: StreamState = "idle";
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private alive = false;
  private reconnectAttempts = 0;
  private messagesReceived = 0;
  private duplicatesDropped = 0;
  private registered = false;
  private readonly frames = { system: 0, callback: 0, event: 0, other: 0 };
  private lastConnectedAt: string | null = null;
  private lastCallbackAt: string | null = null;
  private lastFrameAt: string | null = null;
  private lastTopic: string | null = null;
  private lastError: string | null = null;
  private readonly seen = new Map<string, number>();
  private startedPromise: Promise<void> | null = null;
  private onAbort: (() => void) | null = null;

  constructor(options: StreamTransportOptions) {
    this.options = options;
    this.log = options.logger ?? console;
    this.WebSocketImpl = options.webSocketImpl ?? WebSocket;
  }

  get connected(): boolean {
    return this.state === "connected" && this.socket !== null && this.socket.readyState === 1;
  }

  status(): StreamStatus {
    return {
      state: this.state,
      connected: this.connected,
      registered: this.registered,
      messagesReceived: this.messagesReceived,
      duplicatesDropped: this.duplicatesDropped,
      frames: { ...this.frames },
      lastConnectedAt: this.lastConnectedAt,
      lastCallbackAt: this.lastCallbackAt,
      lastFrameAt: this.lastFrameAt,
      lastTopic: this.lastTopic,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  private emitState(): void {
    try {
      this.options.onStateChange?.(this.status());
    } catch {
      // A listener must never break the connection.
    }
  }

  /** Open the first connection. Later drops reconnect in the background. */
  async start(): Promise<void> {
    if (this.startedPromise) return this.startedPromise;
    this.stopped = false;
    const abort = this.options.signal;
    if (abort?.aborted) {
      this.state = "stopped";
      return;
    }
    this.onAbort = (): void => {
      void this.stop();
    };
    abort?.addEventListener("abort", this.onAbort, { once: true });
    this.startedPromise = this.connect(true).finally(() => {
      this.startedPromise = null;
    });
    return this.startedPromise;
  }

  /** Stop for good: no reconnect, no pending timer, socket closed. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.state = "stopped";
    this.emitState();
    if (this.onAbort && this.options.signal) {
      this.options.signal.removeEventListener("abort", this.onAbort);
      this.onAbort = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.close();
      } catch {
        // already gone
      }
    }
  }

  private async connect(isFirst: boolean): Promise<void> {
    if (this.stopped) return;
    this.state = isFirst ? "connecting" : "reconnecting";
    try {
      const ticket = await this.openConnection();
      if (this.stopped) return;
      await this.openSocket(ticket.endpoint, ticket.ticket);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      if (isFirst) {
        this.state = "failed";
        this.emitState();
        throw error;
      }
      this.log.warn(`[钉钉] stream reconnect failed: ${this.lastError}`);
      this.scheduleReconnect();
    }
  }

  /** HTTPS handshake: returns the single-use WebSocket endpoint + ticket. */
  private async openConnection(): Promise<{ endpoint: string; ticket: string }> {
    const { clientId, clientSecret } = this.options.credentials;
    const apiBase = (this.options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetch(`${apiBase}/v1.0/gateway/connections/open`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          ua: "openchamber-dingtalk/1.0",
          subscriptions: [
            { type: "CALLBACK", topic: TOPIC_ROBOT },
            { type: "CALLBACK", topic: TOPIC_CARD },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`钉钉 Stream 握手失败（HTTP ${response.status}）`);
      }
      const value = (await response.json()) as Record<string, unknown>;
      const endpoint = nonEmpty(value.endpoint);
      const ticket = nonEmpty(value.ticket);
      if (!endpoint || !ticket) throw new Error("钉钉 Stream 握手没有返回连接地址");
      return { endpoint, ticket };
    } finally {
      clearTimeout(timer);
    }
  }

  private openSocket(endpoint: string, ticket: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${endpoint}?ticket=${ticket}`;
      let settled = false;
      const socket = new this.WebSocketImpl(url, { followRedirects: false });
      this.socket = socket;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastError = "钉钉 Stream 连接超时";
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        reject(new Error(this.lastError ?? "钉钉 Stream 连接超时"));
      }, this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      connectTimer.unref?.();

      socket.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.state = "connected";
        this.reconnectAttempts = 0;
        this.connectedAt();
        this.startHeartbeat();
        this.emitState();
        resolve();
      });

      socket.on("message", (data: WebSocket.RawData) => {
        this.onFrame(data.toString());
      });

      socket.on("pong", () => {
        this.alive = true;
      });

      socket.on("error", (error: Error) => {
        this.lastError = error.message;
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(error);
        }
      });

      socket.on("close", () => {
        clearTimeout(connectTimer);
        if (this.socket !== socket) return;
        this.socket = null;
        this.stopHeartbeat();
        if (!settled) {
          settled = true;
          reject(new Error("钉钉 Stream 连接已关闭"));
        }
        if (!this.stopped) {
          this.state = "reconnecting";
          this.emitState();
          this.scheduleReconnect();
        }
      });
    });
  }

  private connectedAt(): void {
    this.lastConnectedAt = new Date().toISOString();
    this.log.log("[钉钉] Stream 已连接");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.alive = true;
    const interval = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== 1) return;
      if (!this.alive) {
        // No pong and no KEEPALIVE for a whole interval: the socket is a
        // zombie (half-open TCP). Terminate so the close handler reconnects.
        this.log.warn("[钉钉] Stream 心跳超时，重建连接");
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        return;
      }
      this.alive = false;
      try {
        socket.ping();
      } catch {
        // close handler deals with it
      }
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delayMs = reconnectDelay(this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(false);
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private send(frame: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(frame));
    } catch (error) {
      this.log.warn(`[钉钉] Stream 回执发送失败: ${String(error)}`);
    }
  }

  private ack(messageId: string | undefined, payload: unknown = { response: { success: true } }): void {
    if (!messageId) return;
    this.send({
      code: 200,
      headers: { contentType: "application/json", messageId },
      message: "OK",
      data: JSON.stringify(payload),
    });
  }

  private onFrame(raw: string): void {
    let frame: StreamFrame;
    try {
      frame = JSON.parse(raw) as StreamFrame;
    } catch {
      this.log.warn("[钉钉] Stream 收到无法解析的帧");
      return;
    }
    const topic = typeof frame.headers?.topic === "string" ? frame.headers.topic : null;
    this.lastFrameAt = new Date().toISOString();
    this.lastTopic = topic;
    if (frame.type === "SYSTEM") this.frames.system++;
    else if (frame.type === "CALLBACK") this.frames.callback++;
    else if (frame.type === "EVENT") this.frames.event++;
    else this.frames.other++;
    if (frame.type === "SYSTEM" && topic === "REGISTERED") this.registered = true;
    // Traffic is proof of registration: this gateway does not always emit a
    // SYSTEM/REGISTERED frame, so a delivered callback must clear the flag.
    if (frame.type === "CALLBACK") this.registered = true;
    try {
      const diagnostic: FrameDiagnostic = {
        type: typeof frame.type === "string" ? frame.type : "unknown",
        topic,
        ...(typeof frame.headers?.messageId === "string" ? { messageId: frame.headers.messageId } : {}),
      };
      if (frame.type === "CALLBACK") {
        let payload: unknown = frame.data;
        try {
          payload = typeof frame.data === "string" ? JSON.parse(frame.data) : frame.data;
        } catch {
          payload = undefined;
        }
        if (payload && typeof payload === "object") {
          const record = payload as Record<string, unknown>;
          diagnostic.payload = {
            keys: Object.keys(record).slice(0, 40),
            ...(typeof record.msgtype === "string" ? { msgtype: record.msgtype } : {}),
            ...(typeof record.conversationType === "string" ? { conversationType: record.conversationType } : {}),
            hasMsgId: typeof record.msgId === "string" && record.msgId.length > 0,
            hasSenderStaffId: typeof record.senderStaffId === "string" && record.senderStaffId.length > 0,
            hasSenderId: typeof record.senderId === "string" && record.senderId.length > 0,
            hasText: !!record.text && typeof record.text === "object",
          };
        }
      }
      this.options.onFrame?.(diagnostic);
    } catch {
      // Diagnostics must never break delivery.
    }

    if (frame.type === "SYSTEM") {
      if (topic === "ping") {
        // Echo the server's own headers so its ping bookkeeping stays intact.
        this.send({ code: 200, headers: frame.headers, message: "OK", data: frame.data });
        this.alive = true;
        return;
      }
      if (topic === "KEEPALIVE" || topic === "REGISTERED" || topic === "CONNECTED") {
        this.alive = true;
        return;
      }
      if (topic === "disconnect") {
        this.state = "reconnecting";
        return;
      }
      return;
    }

    if (frame.type === "CALLBACK") {
      const messageId = frame.headers?.messageId;
      // Acknowledge FIRST: DingTalk redelivers after ~60s without an ack, and
      // the bridge's turn may take minutes.
      this.ack(messageId);
      if (!this.admit(messageId)) return;
      this.lastCallbackAt = new Date().toISOString();
      this.messagesReceived++;
      if (topic === TOPIC_CARD) {
        let cardPayload: unknown = frame.data;
        if (typeof frame.data === "string") {
          try {
            cardPayload = JSON.parse(frame.data);
          } catch {
            this.log.warn("[钉钉] Stream 卡片回调数据无法解析");
            return;
          }
        }
        try {
          this.options.onCardCallback?.(cardPayload);
        } catch (error) {
          this.log.error(`[钉钉] Stream 卡片回调处理失败: ${String(error)}`);
        }
        return;
      }
      let payload: unknown = frame.data;
      if (typeof frame.data === "string") {
        try {
          payload = JSON.parse(frame.data);
        } catch {
          this.log.warn("[钉钉] Stream 回调数据无法解析");
          return;
        }
      }
      try {
        this.options.onMessage(payload as RobotCallback);
      } catch (error) {
        this.log.error(`[钉钉] Stream 回调处理失败: ${String(error)}`);
      }
    }
  }

  /** Message-id de-duplication, bounded in both size and age. */
  private admit(messageId: string | undefined): boolean {
    if (!messageId) return true;
    const now = Date.now();
    for (const [id, at] of this.seen) {
      if (now - at > DEDUPE_TTL_MS) this.seen.delete(id);
      else break;
    }
    if (this.seen.has(messageId)) {
      this.duplicatesDropped++;
      return false;
    }
    this.seen.set(messageId, now);
    while (this.seen.size > DEDUPE_CAP) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }
}