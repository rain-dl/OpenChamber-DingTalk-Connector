# 钉钉桥接（OpenChamber 扩展）

把钉钉机器人（Stream 模式）接到 OpenChamber：在钉钉里给 agent 发消息，回复、授权请求、提问都双向同步。

本项目是 [rain-dl/dsh-dingtalk](https://github.com/rain-dl/dsh-dingtalk) 的 OpenChamber 移植版。钉钉那一侧（Stream 长连接、AI 卡片、媒体上传下载、消息归一化）尽量原样保留；DeepSeek Harness 的插件层换成了 OpenChamber 扩展的服务契约（`sessionControl` + `sessionEvents`）。

## 它长在哪里

| 位置 | 你看到什么 |
|---|---|
| 右侧栏「钉钉桥接」面板 | 填 AppKey / AppSecret / RobotCode、选默认项目目录、看连接状态与最近动态 |
| 钉钉里 | 直接发消息就是给 agent 的新指令；AI 卡片先显示「正在处理」，结束后原地变成完整回复 |
| 会话里 | agent 要授权、要提问时，钉钉里收到可回复的消息，答复直接回传会话 |
| agent 工具 `send_dingtalk` | agent 可以主动往钉钉发消息或本机文件（长任务做完通知你），文件直接变成钉钉里的图片/文件消息 |
| 钉钉里（可选提醒） | 默认只推绑定的那个会话；打开 `/notify on` 后，你在应用里手动开的会话结束时也会推到钉钉 |

```
钉钉（Stream）──► 本地服务 ──► sessions.start / sessions.send ──► OpenChamber 会话
      ▲                │                                             │
      └── AI 卡片 / 文本 ◄── turn-finished · permission-asked ◄───────┘
                              question-asked · turn-failed
```

## 安装

本地目录安装：设置 → 扩展 → 添加，指向这个文件夹（或在聊天里点安装按钮）：

```markdown
[安装钉钉桥接](openchamber://extensions/install?path=D:/Workspace/Privates/Dailin/OpenChamber-DingTalk-Connector)
```

安装时要批准四件事：本地服务（长连接）、会话控制（代你发消息、代你回答授权/提问）、会话事件与转写内容（把回复和问题读出来发到钉钉）、以及一个 OpenCode 插件（`send_dingtalk` 工具，插件代码以你的权限在 OpenCode 里运行）。

## 准备钉钉机器人

1. 打开[钉钉开放平台](https://open-dev.dingtalk.com/)，创建一个**企业内部应用**。
2. 给应用加上**机器人**，消息接收模式选 **Stream 模式**（不需要公网回调地址）。
3. 记下应用的 **AppKey（Client ID）**、**AppSecret**，以及机器人的 **RobotCode**。
4. 回到 OpenChamber，在「钉钉桥接」面板填入这三项，点**保存并连接**。

连接成功后，在钉钉里给这个机器人发一条消息：第一个发消息的人成为绑定用户（想收紧就用面板里的「允许的用户 staffId」白名单）。之后这条钉钉对话就对应一个 OpenChamber 会话。

凭据存在扩展自己的数据目录（`OPENCHAMBER_SERVICE_DATA_DIR/bridge.json`，权限 0600）。面板只回「已保存」，永远读不回 AppSecret。

## 面板

| 字段 | 说明 |
|---|---|
| AppKey / AppSecret | 企业应用的凭据；AppSecret 留空表示不修改 |
| RobotCode | 机器人的编码，留空时用 AppKey |
| 卡片模板 ID | 可选；留空用内置 AI 卡片模板，想换样式就在钉钉后台自建模板 |
| 默认项目目录 | 第一条钉钉消息在这个目录里新建会话；首次打开面板会自动填入当前项目，点「保存设置」生效，也可以点「用当前项目」 |
| 允许的用户 staffId | 逗号分隔；留空表示第一个发消息的人独占 |
| 其它会话结束时也提醒我 | 对应 `/notify on`，默认关闭 |

按钮：**保存并连接** / **断开** / **解除绑定** / **刷新**。

## 钉钉里的命令

直接发消息（包括图片、文件、语音转写）就是给 agent 的指令。命令不经过模型：

| 命令 | 说明 |
|---|---|
| `/help`、`/h` | 命令一览 |
| `/status` | 绑定、目录、运行状态、待回答的请求 |
| `/new [标题]` | 下一条消息开新会话 |
| `/sessions` | 最近由钉钉建过的会话，当前那个打 ✅ |
| `/switch <序号>` | 切回旧会话 |
| `/unbind` | 解除绑定 |
| `/stop` | 中断当前这一轮 |
| `/dir [路径]` | 查看或设置默认项目目录 |
| `/notify on\|off` | 其它会话结束时是否推到钉钉 |
| `/pending`、`/rq` | 查看还等着的授权或提问 |
| `/ping` | 连通性检查 |
| `/id` | 你的 staffId 与当前会话 id |

其它 `/xxx` 原样转给 agent（例如 OpenChamber 自带的 `/compact`）。

## 授权与提问
- **授权**：钉钉收到「需要授权 · 动作 · 资源」，回复 **1** 允许一次，**2** 拒绝（`拒绝：原因` 会把原因带给 agent）。普通文字不算回答，照常发给 agent。
- **提问（表单）**：单字段时回复序号或内容；多字段用「字段=值」每行一项。条件字段、数字、是/否、多选都能解析。
- **页面型提问**只能在 OpenChamber 窗口里回答，钉钉里会收到提示。

「永久允许」仍然是应用里的点击，扩展不会替你做这个决定。

## agent 主动发消息：`send_dingtalk`

扩展随包带一个 OpenCode 插件，给 agent 加了 `send_dingtalk` 工具：

- `text`：一条 Markdown 消息
- `files`：最多 5 个本机文件的绝对路径（每个 ≤ 20 MB），图片变成图片消息，其它变成文件消息

它走与服务共享的目录 `~/.openchamber-dingtalk`（可用 `OPENCHAMBER_DINGTALK_HOME` 改）：插件读 `status.json` 判断服务在不在、有没有配置和绑定，把任务写进 `outbox/`，服务每 4 秒取一次并发送，结果写回 `results/`，工具据此如实回答「已发送」或失败原因。状态超过 30 秒没更新就当作服务没在跑，工具会直接让你去打开面板。

## 和上游 dsh-dingtalk 的差别

保留：Stream 长连接与自动重连、消息回执与去重、session webhook → 机器人接口的回落、AI 卡片（创建/更新/收口）、图片与文件的双向传输、表情状态、单用户单会话绑定、授权/提问的中文格式、`send_dingtalk` 工具（改为 OpenCode 插件）。

换成 OpenChamber 契约：会话的创建/发送/停止/回答、跨会话提醒。

没有移植（DSH 内部能力，OpenChamber 的服务契约没有对应接口）：`/workspace`、`/preset`、`/model`、`/perm`、`/reasoning`、`/fork`、`/history`、`/skill`、`/merge`、`/media`、`/at`、`/surface`、`/raw`、`/steps`。这些在应用里照常可用，只是钉钉侧没有对应命令。

## 开发

```bash
bun install
bun run build     # 打包 panel/main.js、service/main.js 与 plugin/index.js
bun run check     # 宿主会拒绝的包问题
bun test          # 单元测试 + 面板冒烟测试
```

改完源码要重新 `bun run build`：宿主不编译 TypeScript，只加载打包后的 `.js`。

服务可以单独跑起来检查：

```bash
OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t node service/main.js
curl -H 'Authorization: Bearer t' localhost:4599/health
curl -H 'Authorization: Bearer t' localhost:4599/status
```

## 已知限制

1. 需要出网：Stream 长连接要能访问 `api.dingtalk.com` 与 `oapi.dingtalk.com`。
2. 单聊单用户：第一个发消息的人成为绑定用户，其他人会被忽略；白名单可以提前限定。
3. AI 卡片依赖钉钉模板：内置模板失败时自动回退成普通文本消息。
4. 文件走钉钉上传接口，超出钉钉大小限制的文件会被拒绝。
5. 语音按文字处理（钉钉已经把语音转成文字再推过来）。
6. 会话事件是“至多一次”：OpenChamber 关掉或扩展暂停期间的回复不会补发。
7. `send_dingtalk` 依赖桥接服务在运行；服务停掉超过 30 秒后工具会拒绝排队，提示你去打开面板。

## 许可

MIT。源自 [dsh-dingtalk](https://github.com/rain-dl/dsh-dingtalk)（MIT），后者由 [dsh-wechat](https://github.com/pan17/dsh-wechat)（MIT）改写而来。与钉钉、OpenChamber 官方均无隶属关系。
