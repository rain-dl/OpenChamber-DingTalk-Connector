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

安装时要批准五件事：本地服务（长连接）、会话控制（代你发消息、代你回答授权/提问）、会话事件与转写内容（把回复和问题读出来发到钉钉）、一个 OpenCode 插件（`send_dingtalk` 工具，插件代码以你的权限在 OpenCode 里运行），以及只读的 OpenCode 访问（`/s list`、`/ws list`、`/history` 要用）。

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

直接发消息（包括图片、文件、语音转写）就是给 agent 的指令。命令不经过模型，语法与上游 dsh-dingtalk 相同：

| 命令 | 说明 |
|---|---|
| `/help`、`/h`、`/?` | 命令一览；`/help <命令>` 看该命令的全部例子 |
| `/status [brief\|full]` | 连接、绑定、目录、各开关；`full` 加待处理请求与最近动态 |
| `/stop` | 中断当前这一轮 |
| `/next` | 重发被钉钉限流或发送失败而暂存的消息 |
| `/session`、`/s` | `list` 已打开项目里的会话（不含归档）；`list all` 同上；`list current` 当前项目的会话；`switch [current] <编号\|会话 id>` 切过去；`new [标题]` 下一条消息开新会话；裸 `/s` 看状态 |
| `/workspace`、`/ws` | `list [all\|数量]` 列出**OpenChamber 里已打开的项目**；`status` 看默认目录；`switch <编号\|路径>` 换目录；`add <路径>` 校验目录后换过去 |
| `/history` | 默认最近 5 轮；`list all\|数量`、`show <编号>` 看全文 |
| `/at` | `f <路径>` 引用文件到下一条消息；`rm <编号>`、`clear`；裸 `/at` 看已引用 |
| `/merge`、`/mg` | `on\|off\|status`；开启后停顿合并，正文末尾 `..` 继续追加、`!!` 立即提交 |
| `/media`、`/md` | `on\|off` 附件与下一条文字合并；`at\|path` 切换附件写法；裸 `/md` 看状态 |
| `/notify`、`/watch` | `on\|off\|status` 其它会话结束时是否推到钉钉 |
| `/surface`、`/wxprompt` | `on\|off\|status` 给 agent 注入「你在钉钉里对话」的渠道提示词 |
| `/raw` | `on\|off\|once\|status` 强制透传：命令和文本原样交给 agent |
| `/rq`、`/rp` | 关闭待处理的提问卡 / 拒绝待处理的权限卡；`P1=/rq` 点名第 1 张 |

其它 `/xxx` 原样转给 agent（例如 OpenChamber 自带的 `/compact`）；打错的命令（如 `/statu`）会给出正确拼写而不是转发。

**OpenChamber 没有对应能力、因此未提供的命令**：`/fork`、`/preset`、`/model`、`/reasoning`、`/perm`、`/enter`、`/steps`、`/skill`、`/flush`，以及 `/s pin|unpin`、`/notify tasks`、`/at s`。这些能力在 OpenChamber 应用里照常可用，只是钉钉侧没有对应实现；`/help` 的页脚也会说明。

`/s list` 与 `/ws list` 的列表来源：

- `/ws list`：**OpenChamber 里已打开的项目**（读应用自己的 `settings.json` 里的 `projects`），不是底层 OpenCode 注册的全部项目。读不到配置时退回 OpenCode 的项目列表，并在标题里注明。
- `/s list`：**只看已打开项目的会话**——会话目录等于某个项目目录或在其子目录下才算，快捷聊天、别的目录的会话都不列；归档（`time.archived`）也不列。项目列表读不到时不筛，避免列表空掉。
- `/s list all` 与默认一致，保留只为兼容上游语法；`/s list current` 再按当前项目目录收窄。

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

保留：Stream 长连接与自动重连、消息回执与去重、session webhook → 机器人接口的回落、AI 卡片（创建/更新/收口）、图片与文件的双向传输、表情状态、单用户单会话绑定、授权/提问的中文格式、`send_dingtalk` 工具（改为 OpenCode 插件）、以及命令语法（`/help`、`/status`、`/stop`、`/next`、`/session`、`/workspace`、`/history`、`/at`、`/merge`、`/media`、`/notify`、`/surface`、`/raw`、`/rq`、`/rp`）。

换成 OpenChamber 契约：会话的创建/发送/停止/回答、跨会话提醒；`/s list`、`/ws list`、`/history` 通过宿主的只读 OpenCode 接口实现。

没有移植（DSH 内部能力，OpenChamber 的服务契约没有对应接口）：`/fork`、`/preset`、`/model`、`/reasoning`、`/perm`、`/enter`、`/steps`、`/skill`、`/flush`。这些在应用里照常可用，只是钉钉侧没有对应命令。

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
