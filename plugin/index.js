// service/spool.ts
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var SPOOL_HOME_ENV = "OPENCHAMBER_DINGTALK_HOME";
function spoolRoot(env = process.env) {
  const custom = (env[SPOOL_HOME_ENV] ?? "").trim();
  if (custom)
    return custom;
  return path.join(os.homedir(), ".openchamber-dingtalk");
}
function statusFile(env = process.env) {
  return path.join(spoolRoot(env), "status.json");
}
function outboxDir(env = process.env) {
  return path.join(spoolRoot(env), "outbox");
}
function resultsDir(env = process.env) {
  return path.join(spoolRoot(env), "results");
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 384 });
  await rename(temp, file);
}
async function readBridgeStatus(env) {
  try {
    const parsed = JSON.parse(await readFile(statusFile(env), "utf8"));
    if (!parsed || typeof parsed !== "object")
      return null;
    return {
      v: 1,
      at: Number(parsed.at) || 0,
      configured: !!parsed.configured,
      enabled: !!parsed.enabled,
      connected: !!parsed.connected,
      bound: !!parsed.bound,
      ...typeof parsed.userId === "string" ? { userId: parsed.userId } : {},
      ...typeof parsed.sessionId === "string" ? { sessionId: parsed.sessionId } : {}
    };
  } catch {
    return null;
  }
}
async function enqueueOutboxJob(input, env) {
  const dir = outboxDir(env);
  await mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    v: 1,
    id,
    at: Date.now(),
    ...input.text ? { text: input.text } : {},
    ...input.files && input.files.length > 0 ? { files: input.files } : {}
  };
  await writeJsonAtomic(path.join(dir, `${id}.json`), job);
  return id;
}
async function readOutboxResult(id, env) {
  try {
    const parsed = JSON.parse(await readFile(path.join(resultsDir(env), `${id}.json`), "utf8"));
    return { at: Number(parsed.at) || 0, ok: !!parsed.ok, ...parsed.error ? { error: String(parsed.error) } : {} };
  } catch {
    return null;
  }
}

// plugin/index.ts
var STATUS_FRESH_MS = 30000;
var WAIT_MS = 15000;
var POLL_MS = 300;
var MAX_FILES = 5;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForResult(id) {
  const start = Date.now();
  while (Date.now() - start < WAIT_MS) {
    const result = await readOutboxResult(id);
    if (result)
      return result;
    await sleep(POLL_MS);
  }
  return null;
}
function baseName(file) {
  return file.split(/[\\/]/).filter(Boolean).pop() ?? file;
}
var plugin_default = {
  id: "dingtalk-bridge",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "send_dingtalk",
        description: "给用户在钉钉里的机器人会话发一条消息或几个本机文件。用户往往不在 OpenChamber 窗口旁边：长任务做完时用它主动通知，或把产出的文件送到钉钉。",
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            text: { type: "string", description: "要发送的文字，支持 Markdown。" },
            files: {
              type: "array",
              items: { type: "string" },
              description: "要发送的本机文件绝对路径，最多 5 个，每个不超过 20 MB。"
            }
          },
          additionalProperties: false
        },
        async execute(args) {
          const text = typeof args?.text === "string" ? args.text.trim() : "";
          const files = Array.isArray(args?.files) ? args.files.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
          if (!text && files.length === 0)
            throw new Error("text 和 files 至少给一个。");
          if (files.length > MAX_FILES)
            throw new Error(`一次最多发 ${MAX_FILES} 个文件。`);
          const status = await readBridgeStatus();
          if (!status || Date.now() - status.at > STATUS_FRESH_MS) {
            throw new Error(`钉钉桥接服务没在运行（${spoolRoot()} 里没有新状态）。在 OpenChamber 里打开「钉钉桥接」面板点一次刷新。`);
          }
          if (!status.configured)
            throw new Error("钉钉桥接还没配置 AppKey / AppSecret，先在面板里填好。");
          if (!status.bound)
            throw new Error("钉钉里还没有人和机器人绑定：先在钉钉里给机器人发一条消息。");
          const id = await enqueueOutboxJob({
            ...text ? { text } : {},
            ...files.length > 0 ? { files } : {}
          });
          const result = await waitForResult(id);
          if (!result)
            return { content: "已交给钉钉桥接，会在几秒内发出。" };
          if (!result.ok)
            throw new Error(`钉钉发送失败：${result.error ?? "未知原因"}`);
          const parts = [text ? "1 条消息" : "", ...files.map(baseName)].filter(Boolean);
          return { content: `已发送到钉钉：${parts.join("、")}。` };
        }
      });
    });
  }
};
export {
  plugin_default as default
};
