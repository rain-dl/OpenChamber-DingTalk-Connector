# AGENTS.md

钉钉桥接是一个 OpenChamber 扩展：面板 + 本地服务 + 一个 OpenCode 插件。改动前先读 `README.md`（用户视角）和本文件（约束）。

## 目录

```
panel/            右侧栏面板（index.html + main.js，展示逻辑在 view.ts）
service/          本地服务：HTTP 路由、Stream 长连接、会话桥接、配置落盘
service/dingtalk/ 钉钉协议层（移植自 dsh-dingtalk，尽量保持原样）
service/catalog.ts 命令帮助目录（与上游 help-catalog 同构）
service/slash.ts  命令解析（语法对齐上游 slash.ts）
service/opencode.ts 只读的会话/项目来源（provides: ["opencode"]）
plugin/           OpenCode 插件：send_dingtalk 工具
tests/            bun test（含 jsdom 面板冒烟与命令例子防漂移）
```

## 硬性约束

- **宿主不编译 TypeScript**：改完 `panel/*.ts`、`service/*.ts`、`plugin/index.ts` 都要 `bun run build`，三份产物是 `panel/main.js`、`service/main.js`、`plugin/index.js`。提交/发布时带上产物。
- **服务只监听 `127.0.0.1`**，每个请求（含 `/health`）都要 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`。
- **状态写在 `OPENCHAMBER_SERVICE_DATA_DIR`**，绝不写进包目录（会触发扩展重载）。没有该变量时退到 `~/.openchamber-dingtalk`。
- **AppSecret 只进不出**：`/status` 只回 `hasSecret`，面板不回读；日志里不要出现凭据。
- **会话事件先回 200 再干活**：`/session-events` 必须在 10 秒内应答，处理走 `setImmediate`。
- **卡片要收口**：回合被 `/stop`、`/s new`、`/ws switch` 或服务关停打断时，用 `closeCards()` 结束卡片，别让用户一直看到转圈。回合代号（`bumpEpoch`）用来作废“建到一半”的卡片。
- **命令语法必须与上游一致**：`service/slash.ts` 的解析规则对应 `service/catalog.ts` 里的每一条 `usage`/`examples`；`tests/slash.test.ts` 会拿目录里的每一行去解析，写了却解析不了会直接失败。OpenChamber 没有对应能力的命令才允许不提供，并写进 `HELP_FOOTER`。
- **OpenCode 读接口的真实形状**（对着宿主 2.7.3 抓的）：项目目录在 `canonical`（不是 worktree）；会话在 `{ data: [...] }` 里，目录是 `location.directory`，归档看 `time.archived`，“正在运行”只能从 `/api/session/active` 的 `{ data: { id: { type } } }` 拿。改 `service/opencode.ts` 前先看这段，别按直觉猜字段。
- **插件与服务只通过 `~/.openchamber-dingtalk` 通信**（可用 `OPENCHAMBER_DINGTALK_HOME` 覆盖）：`status.json`、`outbox/`、`results/`。插件拿不到端口和令牌，不要试图让它直连服务。
- **UI 一律用 `@openchamber/sdk/ui`** 的 mount 函数（跟随主题）；不要自己造控件或轮询，状态靠 `host.onServiceEvent('state')` 触发刷新。

## 验证

```bash
bun run build     # 三份产物
bun run check     # 宿主安装时会拒绝的问题（等价于 Settings → Extensions 的检查）
bun run typecheck # tsc：面板、服务、插件、测试
bun test          # 182+ 项：命令语法（目录例子全部可解析）、桥接、历史/项目、插件投递、面板 jsdom
```

服务单独验收：

```bash
OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t \
OPENCHAMBER_SERVICE_DATA_DIR=./tmp OPENCHAMBER_DINGTALK_HOME=./tmp-home \
node service/main.js
curl -H 'Authorization: Bearer t' localhost:4599/health
```

## 约定

- 用户可见文案用中文，代码标识符用英文。
- 新增钉钉侧命令时同时更新 `service/catalog.ts`、`service/slash.ts`、README 的命令表和 `tests/slash.test.ts`（目录里的例子就是防漂移用例）。
- `engines.openchamber` 的下限别低于用到的最低特性（当前 `>=2.7.3`：`sessionControl.answers` + `sessionEvents` + `marks` 之后的契约）。
