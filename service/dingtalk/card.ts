/**
 * One throttled AI-card stream per agent turn.
 *
 * The card is the answer surface: it is created the moment the turn produces
 * its first line of output, updated with the accumulated body (work steps and
 * the answer so far), and finalised with the complete reply. Updates are
 * latest-wins and rate-limited, so a burst of ten stream frames costs one
 * request instead of ten — DingTalk rejects bursts with 403 and a lost update
 * is invisible to the user.
 *
 * Failure policy: a card that cannot be created returns `false` and the
 * caller falls back to ordinary text messages. A card that fails MID-FLIGHT is
 * closed with an explicit error state, so the user never stares at a spinner
 * that will not resolve; the caller then delivers the remaining text normally.
 */

import type { DingTalkApi, CardTarget } from "./api.js";
import type { DingTalkCredentials } from "./types.js";

const DEFAULT_UPDATE_INTERVAL_MS = 500;
const DEFAULT_FINALIZE_TIMEOUT_MS = 5_000;
export const CARD_CLOSED_TEXT = "卡片已结束，请查看后续消息。";

export interface CardStreamOptions {
  api: DingTalkApi;
  credentials: Pick<DingTalkCredentials, "clientId" | "clientSecret">;
  robotCode: string;
  cardTemplateId?: string;
  target: CardTarget;
  logger?: Pick<Console, "warn" | "error">;
  updateIntervalMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}

type Phase = "idle" | "starting" | "active" | "finishing" | "finished" | "failed" | "aborted";

export class DingTalkCardStream {
  private readonly options: CardStreamOptions;
  private readonly log: Pick<Console, "warn" | "error">;
  private readonly now: () => number;
  private readonly updateIntervalMs: number;
  private phase: Phase;
  private cardInstanceId: string | null = null;
  private pendingText: string | null = null;
  private scheduledUpdate: NodeJS.Timeout | null = null;
  private updateWorker: Promise<void> | null = null;
  private finishPromise: Promise<boolean> | null = null;
  private lastUpdateAt = 0;
  private readonly onAbort: () => void;

  constructor(options: CardStreamOptions) {
    this.options = options;
    this.log = options.logger ?? console;
    this.now = options.now ?? (() => Date.now());
    this.updateIntervalMs = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
    this.phase = options.signal?.aborted ? "aborted" : "idle";
    this.onAbort = (): void => {
      if (this.phase === "finished" || this.phase === "failed" || this.phase === "aborted") return;
      void this.closeCard();
      this.close("aborted");
    };
    if (this.phase !== "aborted") options.signal?.addEventListener("abort", this.onAbort, { once: true });
  }

  get cardId(): string | undefined {
    return this.cardInstanceId ?? undefined;
  }

  /** True while the card accepts updates (created and not finalised). */
  get active(): boolean {
    return this.phase === "active";
  }

  get started(): boolean {
    return this.cardInstanceId !== null;
  }

  /** Create + deliver the card. `false` means "fall back to plain text". */
  async start(initialText: string): Promise<boolean> {
    if (this.phase !== "idle") return false;
    const body = initialText.trim();
    if (!body) return false;
    this.phase = "starting";
    try {
      const created = await this.options.api.createAiCard({
        credentials: this.options.credentials,
        robotCode: this.options.robotCode,
        target: this.options.target,
        text: body,
        ...(this.options.cardTemplateId ? { cardTemplateId: this.options.cardTemplateId } : {}),
        ...(this.options.signal ? { signal: this.options.signal } : {}),
      });
      this.cardInstanceId = created.cardInstanceId;
      if (this.phase !== "starting") {
        await this.closeCard();
        return false;
      }
      this.lastUpdateAt = this.now();
      this.phase = "active";
      return true;
    } catch (error) {
      if (this.options.signal?.aborted) {
        this.close("aborted");
        return false;
      }
      this.log.warn(`[钉钉] AI 卡片创建失败，回退为文本消息: ${String(error)}`);
      this.close("failed");
      return false;
    }
  }

  /** Latest-wins update; never throws and never blocks the caller. */
  push(text: string): void {
    if (this.phase !== "active") return;
    const body = text.trim();
    if (!body) return;
    this.pendingText = body;
    if (!this.scheduledUpdate && !this.updateWorker) this.launchUpdate();
  }

  /** Finalise with the complete reply. `true` means the card carried it. */
  async finish(finalText: string): Promise<boolean> {
    const body = finalText.trim();
    if (this.phase === "finished") return true;
    if (this.phase === "finishing") return this.finishPromise ?? false;
    if (this.phase !== "active" || !body) return false;

    this.phase = "finishing";
    this.pendingText = null;
    this.clearScheduled();
    const activeUpdate = this.updateWorker;
    this.finishPromise = (async () => {
      if (activeUpdate) await activeUpdate.catch(() => undefined);
      if (this.phase !== "finishing") return false;
      try {
        await this.options.api.finishAiCard({
          credentials: this.options.credentials,
          robotCode: this.options.robotCode,
          target: this.options.target,
          cardInstanceId: this.cardInstanceId ?? "",
          text: body,
          ...(this.options.signal ? { signal: this.options.signal } : {}),
        });
        if (this.phase !== "finishing") return false;
        this.close("finished");
        return true;
      } catch (error) {
        if (this.options.signal?.aborted) {
          this.close("aborted");
          return false;
        }
        this.log.error(`[钉钉] AI 卡片完成失败: ${String(error)}`);
        this.close("failed");
        return false;
      }
    })();
    return this.finishPromise;
  }

  /** Close the card with an error note (agent error, /stop, …). */
  async fail(text: string): Promise<boolean> {
    const body = text.trim();
    if (this.phase === "finished" || this.phase === "failed" || this.phase === "aborted") return false;
    if (!this.cardInstanceId || !body) {
      this.close("failed");
      return false;
    }
    this.phase = "finishing";
    this.pendingText = null;
    this.clearScheduled();
    const activeUpdate = this.updateWorker;
    if (activeUpdate) await activeUpdate.catch(() => undefined);
    try {
      await this.options.api.failAiCard({
        credentials: this.options.credentials,
        robotCode: this.options.robotCode,
        target: this.options.target,
        cardInstanceId: this.cardInstanceId,
        text: body,
        signal: AbortSignal.timeout(DEFAULT_FINALIZE_TIMEOUT_MS),
      });
      this.close("failed");
      return true;
    } catch {
      this.close("failed");
      return false;
    }
  }

  private close(phase: Phase): void {
    this.phase = phase;
    this.pendingText = null;
    this.clearScheduled();
    this.options.signal?.removeEventListener("abort", this.onAbort);
  }

  private clearScheduled(): void {
    if (this.scheduledUpdate) {
      clearTimeout(this.scheduledUpdate);
      this.scheduledUpdate = null;
    }
  }

  private async closeCard(): Promise<void> {
    if (!this.cardInstanceId) return;
    await this.options.api.failAiCard({
      credentials: this.options.credentials,
      robotCode: this.options.robotCode,
      target: this.options.target,
      cardInstanceId: this.cardInstanceId,
      text: CARD_CLOSED_TEXT,
      signal: AbortSignal.timeout(DEFAULT_FINALIZE_TIMEOUT_MS),
    }).catch(() => undefined);
  }

  private launchUpdate(): void {
    if (this.phase !== "active" || this.updateWorker || this.pendingText === null) return;
    const delayMs = Math.max(0, this.lastUpdateAt + this.updateIntervalMs - this.now());
    if (delayMs > 0) {
      this.scheduledUpdate = setTimeout(() => {
        this.scheduledUpdate = null;
        this.launchUpdate();
      }, delayMs);
      this.scheduledUpdate.unref?.();
      return;
    }

    const text = this.pendingText;
    this.pendingText = null;
    this.updateWorker = (async () => {
      try {
        await this.options.api.updateAiCard({
          credentials: this.options.credentials,
          robotCode: this.options.robotCode,
          target: this.options.target,
          cardInstanceId: this.cardInstanceId ?? "",
          text,
          ...(this.options.signal ? { signal: this.options.signal } : {}),
        });
        this.lastUpdateAt = this.now();
      } catch (error) {
        if (this.options.signal?.aborted || this.phase === "aborted") return;
        this.log.error(`[钉钉] AI 卡片更新失败: ${String(error)}`);
        this.close("failed");
      }
    })().finally(() => {
      this.updateWorker = null;
      if (this.phase === "active" && this.pendingText !== null) this.launchUpdate();
    });
  }
}
