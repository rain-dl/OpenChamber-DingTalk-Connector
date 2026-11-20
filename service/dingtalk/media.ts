/**
 * Inbound attachment download.
 *
 * DingTalk never puts the bytes in the callback: the message carries a
 * `downloadCode` that must be redeemed for a signed URL
 * (`/v1.0/robot/messageFiles/download`) and only then downloaded. The bridge
 * stores the bytes next to the session workspace exactly like the DingTalk
 * channel stored CDN media, so nothing downstream changed shape.
 */

import path from "node:path";
import { DingTalkApiError, type DingTalkApi } from "./api.js";
import type { DingTalkCredentials, InboundAttachment } from "./types.js";

export interface DownloadedAttachment {
  bytes: Buffer;
  /** Sanitised file name safe to write inside the download directory. */
  fileName: string;
  /** Best-effort MIME type (from the response, else from the extension). */
  mimeType: string;
  kind: InboundAttachment["kind"];
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/zip": ".zip",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".amr": "audio/amr",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

/**
 * Strip every path separator and control character: a remote-supplied file
 * name must never choose WHERE the file is written.
 */
export function safeAttachmentName(raw: string | undefined, fallbackExtension: string): string {
  const base = typeof raw === "string" ? raw : "";
  const name = base
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  if (!name) return `attachment${fallbackExtension}`;
  return name.length > 120 ? `${name.slice(0, 100)}${path.extname(name).slice(0, 20) || fallbackExtension}` : name;
}

/** Download one inbound attachment, bounded by `maxBytes`. */
export async function downloadAttachment(
  api: DingTalkApi,
  credentials: DingTalkCredentials,
  attachment: InboundAttachment,
  options: { robotCode: string; maxBytes?: number; signal?: AbortSignal } = { robotCode: credentials.robotCode },
): Promise<DownloadedAttachment> {
  const { bytes, contentType } = await api.downloadAttachment({
    credentials,
    downloadCode: attachment.downloadCode,
    robotCode: options.robotCode,
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const declared = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const guessedExtension = EXTENSION_BY_MIME[declared]
    ?? (attachment.kind === "image" ? ".jpg" : attachment.kind === "video" ? ".mp4" : attachment.kind === "audio" ? ".amr" : ".bin");
  const fileName = safeAttachmentName(attachment.fileName, guessedExtension);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension]
    ?? (declared && declared !== "application/octet-stream" ? declared : "application/octet-stream");

  if (bytes.length === 0) {
    throw new DingTalkApiError("download-failed", "钉钉附件内容为空。");
  }
  return { bytes, fileName, mimeType, kind: attachment.kind };
}