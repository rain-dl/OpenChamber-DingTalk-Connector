/**
 * 随扩展一起下发的 OpenCode 插件：给 agent 一个 `send_dingtalk` 工具。
 *
 * 插件跑在 OpenCode 里，拿不到桥接服务的端口和令牌，所以走共享目录：
 * 读服务写的 `status.json` 判断能不能发，把任务放进 `outbox/`，再等 `results/` 的回执。
 * 这个文件不 import 任何第三方包（共享模块会被打包进来），OpenCode 直接 `import()` 它。
 */

import {
  enqueueOutboxJob,
  readBridgeStatus,
  readOutboxResult,
  spoolRoot,
} from '../service/spool.js';

type ToolResult = { content: string };

type ToolDefinition = {
  name: string;
  description: string;
  options?: { codemode: boolean };
  input: Record<string, unknown>;
  execute: (args: { text?: unknown; files?: unknown }) => Promise<ToolResult>;
};

type ToolList = { add: (tool: ToolDefinition) => void };

type PluginContext = {
  tool: { transform: (edit: (tools: ToolList) => void) => Promise<void> };
};

/** 服务每 4 秒扫一次 outbox；状态超过这个岁数就当服务没在跑。 */
const STATUS_FRESH_MS = 30_000;
const WAIT_MS = 15_000;
const POLL_MS = 300;
const MAX_FILES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForResult(id: string) {
  const start = Date.now();
  while (Date.now() - start < WAIT_MS) {
    const result = await readOutboxResult(id);
    if (result) return result;
    await sleep(POLL_MS);
  }
  return null;
}

function baseName(file: string): string {
  return file.split(/[\\/]/).filter(Boolean).pop() ?? file;
}

export default {
  id: 'dingtalk-bridge',
  setup: async (ctx: PluginContext) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: 'send_dingtalk',
        description:
          '给用户在钉钉里的机器人会话发一条消息或几个本机文件。用户往往不在 OpenChamber 窗口旁边：长任务做完时用它主动通知，或把产出的文件送到钉钉。',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要发送的文字，支持 Markdown。' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: '要发送的本机文件绝对路径，最多 5 个，每个不超过 20 MB。',
            },
          },
          additionalProperties: false,
        },
        async execute(args) {
          const text = typeof args?.text === 'string' ? args.text.trim() : '';
          const files = Array.isArray(args?.files)
            ? args.files.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [];
          if (!text && files.length === 0) throw new Error('text 和 files 至少给一个。');
          if (files.length > MAX_FILES) throw new Error(`一次最多发 ${MAX_FILES} 个文件。`);

          const status = await readBridgeStatus();
          if (!status || Date.now() - status.at > STATUS_FRESH_MS) {
            throw new Error(`钉钉桥接服务没在运行（${spoolRoot()} 里没有新状态）。在 OpenChamber 里打开「钉钉桥接」面板点一次刷新。`);
          }
          if (!status.configured) throw new Error('钉钉桥接还没配置 AppKey / AppSecret，先在面板里填好。');
          if (!status.bound) throw new Error('钉钉里还没有人和机器人绑定：先在钉钉里给机器人发一条消息。');

          const id = await enqueueOutboxJob({
            ...(text ? { text } : {}),
            ...(files.length > 0 ? { files } : {}),
          });
          const result = await waitForResult(id);
          if (!result) return { content: '已交给钉钉桥接，会在几秒内发出。' };
          if (!result.ok) throw new Error(`钉钉发送失败：${result.error ?? '未知原因'}`);
          const parts = [text ? '1 条消息' : '', ...files.map(baseName)].filter(Boolean);
          return { content: `已发送到钉钉：${parts.join('、')}。` };
        },
      });
    });
  },
};
