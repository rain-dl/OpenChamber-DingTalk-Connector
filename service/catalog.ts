/**
 * 命令帮助目录 —— 与上游 dsh-dingtalk 的 `help-catalog.ts` 同构。
 *
 * 只收录**在这个扩展里真的存在**的命令：OpenChamber 没有对应能力的
 * （fork / preset / model / reasoning / perm / enter / steps / skill / flush）
 * 一律不列，并在页脚说明原因，免得 `/help` 教出一堆用不了的东西。
 *
 * 每个条目的 command / aliases / usage / examples 与上游保持一致，
 * 只有 usage 里被删掉的子命令会去掉（例如 `/s pin`）。
 */

export type HelpGroupId = 'basics' | 'navigate' | 'pacing' | 'reference' | 'card';

export type HelpExample = { line: string; note: string; kind?: 'command' | 'text' };

export type HelpEntry = {
  command: string;
  aliases: string[];
  summary: string;
  usage: string;
  examples: HelpExample[];
  group: HelpGroupId;
};

export type HelpGroup = { id: HelpGroupId; title: string; blurb: string };

const GROUPS: HelpGroup[] = [
  { id: 'basics', title: '常用', blurb: '查看帮助、查看状态、中断任务。' },
  { id: 'navigate', title: '会话与项目', blurb: '会话是一段独立的对话；项目是一个工作目录。' },
  { id: 'pacing', title: '输出节奏', blurb: '控制推送到钉钉的内容与时机。' },
  { id: 'reference', title: '引用与回看', blurb: '引用文件，或查看历史记录。' },
  { id: 'card', title: '待处理卡片', blurb: '关闭等待确认的权限卡与提问卡。' },
];

export const HELP_INTRO = '以 / 开头的消息是指令。`/help <命令>` 看该命令的全部例子。';

export const HELP_FOOTER = [
  'OpenChamber 没有对应能力的命令未提供：`/fork`、`/preset`、`/model`、`/reasoning`、`/perm`、`/enter`、`/steps`、`/skill`、`/flush`。',
  '这些能力在 OpenChamber 应用里照常可用，只是钉钉侧没有对应命令。',
].join('\n');

const ENTRIES: HelpEntry[] = [
  {
    command: '/help',
    aliases: ['h', '?'],
    summary: '查看指令清单与示例',
    usage: '/help | /help <命令名或简写>（也可以 /h 或 /?）',
    group: 'basics',
    examples: [
      { line: '/help', note: '全部指令一览' },
      { line: '/help s', note: '该命令的全部例子' },
      { line: '/help merge', note: '写全名也一样' },
      { line: '/h', note: '同 /help' },
      { line: '/?', note: '同 /help' },
    ],
  },
  {
    command: '/status',
    aliases: [],
    summary: '查看当前状态，可切简洁或详细',
    usage: '/status [brief|full]',
    group: 'basics',
    examples: [
      { line: '/status', note: '连接、绑定、目录与各开关' },
      { line: '/status brief', note: '只显示模式与绑定摘要' },
      { line: '/status full', note: '加上待处理请求与最近动态' },
    ],
  },
  {
    command: '/stop',
    aliases: [],
    summary: '中断当前任务',
    usage: '/stop',
    group: 'basics',
    examples: [{ line: '/stop', note: '已修改的文件不回滚' }],
  },
  {
    command: '/next',
    aliases: [],
    summary: '继续发送暂存的消息',
    usage: '/next',
    group: 'basics',
    examples: [{ line: '/next', note: '重发钉钉限流或发送失败而暂存的消息' }],
  },
  {
    command: '/session',
    aliases: ['s'],
    summary: '会话管理：列出、切换、新建',
    usage: '/session list [current] [all|数量] | switch [current] <编号|会话 id> | new [标题] | status（裸 /s 看状态）',
    group: 'navigate',
    examples: [
      { line: '/s list', note: '最近 20 个会话（含应用里开的）' },
      { line: '/s list current', note: '仅当前项目目录的会话' },
      { line: '/s list all', note: '全部会话' },
      { line: '/s switch 3', note: '切换到第 3 个（编号见 /s list）' },
      { line: '/s switch current 2', note: '当前项目列表第 2 个' },
      { line: '/s new', note: '下一条消息开新会话' },
      { line: '/s status', note: '当前会话状态' },
    ],
  },
  {
    command: '/workspace',
    aliases: ['ws'],
    summary: '工作区管理：列出、切换',
    usage: '/workspace list [all|数量] | status | switch <编号|路径> | add <路径>（裸 /ws 看状态）',
    group: 'navigate',
    examples: [
      { line: '/workspace list', note: '最近 20 个项目目录' },
      { line: '/workspace list all', note: '全部项目目录' },
      { line: '/workspace status', note: '当前默认目录' },
      { line: '/workspace switch 2', note: '把第 2 个设为新会话目录' },
      { line: '/workspace switch D:\\projects\\my-app', note: '按路径切换' },
      { line: '/workspace add D:\\projects\\new-app', note: '添加并切换（只改钉钉会话的默认目录）' },
    ],
  },
  {
    command: '/merge',
    aliases: ['mg'],
    summary: '打字合并：多条消息合成一轮',
    usage: '/merge on|off|status；正文末尾 `..` 继续追加、`!!` 立刻提交',
    group: 'pacing',
    examples: [
      { line: '/merge on', note: '开启：静默窗口后合并' },
      { line: '/merge off', note: '关闭并发送暂存消息' },
      { line: '/merge', note: '窗口、上限、暂存条数' },
      { line: '/merge status', note: '同上' },
      { line: '帮我改下登录页 ..', note: '追加：先不发送（需先 /merge on）', kind: 'text' },
      { line: '跑一下测试 !!', note: '立即提交（需先 /merge on）', kind: 'text' },
    ],
  },
  {
    command: '/media',
    aliases: ['md'],
    summary: '图片/文件与文字合并发送',
    usage: '/media on|off | at|path | status',
    group: 'pacing',
    examples: [
      { line: '/media on', note: '开启：附件与下一条文字合并' },
      { line: '/media off', note: '关闭并发送暂存附件' },
      { line: '/media at', note: '附件写成 @路径' },
      { line: '/media path', note: '附件写成「附件路径：…」' },
      { line: '/media', note: '两个开关的状态' },
      { line: '/media status', note: '同上' },
    ],
  },
  {
    command: '/notify',
    aliases: [],
    summary: '跨会话提醒推送',
    usage: '/notify on|off|status（也可以 /watch）',
    group: 'pacing',
    examples: [
      { line: '/notify on', note: '开启：其它会话结束也推钉钉' },
      { line: '/notify off', note: '关闭' },
      { line: '/notify', note: '当前状态' },
      { line: '/notify status', note: '同上' },
    ],
  },
  {
    command: '/surface',
    aliases: [],
    summary: '钉钉渠道提示词开关',
    usage: '/surface on|off|status（也可以 /wxprompt）',
    group: 'pacing',
    examples: [
      { line: '/surface on', note: '开启：给 agent 注入钉钉渠道提示词' },
      { line: '/surface off', note: '关闭' },
      { line: '/surface', note: '当前状态' },
    ],
  },
  {
    command: '/raw',
    aliases: [],
    summary: '强制透传：斜杠命令和文本原样交给 agent',
    usage: '/raw on|off|once|status（透传期间只有 /raw 本身仍被拦截）',
    group: 'pacing',
    examples: [
      { line: '/raw on', note: '开启：之后每条消息都原样转发' },
      { line: '/raw once', note: '只透传下一条，然后自动关闭' },
      { line: '/raw off', note: '关闭（透传期间这条仍有效）' },
      { line: '/raw', note: '查看当前是否在透传' },
    ],
  },
  {
    command: '/at',
    aliases: [],
    summary: '引用文件到下一条消息',
    usage: '/at [f <路径> | rm <编号> | clear]；引用会话（s）在 OpenChamber 没有对应能力',
    group: 'reference',
    examples: [
      { line: '/at', note: '查看已引用（文件 N 个）' },
      { line: '/at f D:\\logs\\build.log', note: '引用文件' },
      { line: '/at f "D:\\my docs\\spec.md"', note: '含空格的路径加引号' },
      { line: '/at rm 1', note: '移除第 1 个引用' },
      { line: '/at clear', note: '清空全部引用' },
    ],
  },
  {
    command: '/history',
    aliases: [],
    summary: '回看历史轮次',
    usage: '/history [list [all|数量] | show <编号>]（默认最近 5 轮）',
    group: 'reference',
    examples: [
      { line: '/history', note: '最近 5 轮，末轮全文' },
      { line: '/history list 10', note: '最近 10 轮' },
      { line: '/history list all', note: '全部轮次' },
      { line: '/history show 3', note: '第 3 轮的完整问答' },
    ],
  },
  {
    command: '/rq',
    aliases: [],
    summary: '关闭待处理卡片',
    usage: '/rq；其它卡片用 P1=/rq 这种写法点名',
    group: 'card',
    examples: [
      { line: '/rq', note: '关闭当前会话全部提问卡' },
      { line: 'P1=/rq', note: '仅关闭第 1 张卡' },
      { line: '/rp', note: '只拒绝权限卡' },
    ],
  },
  {
    command: '/rp',
    aliases: [],
    summary: '拒绝待处理的权限卡',
    usage: '/rp；其它卡片用 P1=/rp 这种写法点名',
    group: 'card',
    examples: [
      { line: '/rp', note: '拒绝当前会话全部权限请求' },
      { line: 'P2=/rp', note: '仅拒绝第 2 张卡' },
    ],
  },
];

/** `/session` → `/s`；`/workspace` → `/ws`。 */
export function shortestSpelling(entry: HelpEntry): string {
  const names = [entry.command.replace(/^\//, ''), ...entry.aliases];
  const shortest = names.reduce((best, name) => (name.length < best.length ? name : best));
  return `/${shortest}`;
}

export function findHelpEntry(topic: string): HelpEntry | undefined {
  const needle = topic.trim().replace(/^\//, '').toLowerCase();
  if (!needle) return undefined;
  return ENTRIES.find((entry) => (
    entry.command.replace(/^\//, '').toLowerCase() === needle
    || entry.aliases.some((alias) => alias.toLowerCase() === needle)
  ));
}

export function groupTitle(id: HelpGroupId): string {
  return GROUPS.find((group) => group.id === id)?.title ?? id;
}

/** `/help` 的一览：每条命令一行，短拼写优先。 */
export function formatHelp(): string {
  const lines: string[] = ['🤖 **钉钉 ⇄ OpenChamber**', HELP_INTRO, ''];
  for (const group of GROUPS) {
    const entries = ENTRIES.filter((entry) => entry.group === group.id);
    if (entries.length === 0) continue;
    lines.push(`**${group.title}**`);
    for (const entry of entries) {
      lines.push(`\`${shortestSpelling(entry)}\` · ${entry.summary}`);
    }
    lines.push('');
  }
  lines.push(HELP_FOOTER);
  return lines.join('\n');
}

/** `/help <命令>` 的详情：用法 + 全部例子。 */
export function helpTopic(entry: HelpEntry): string {
  const lines = [
    `**${shortestSpelling(entry)}**（\`${entry.command}\`） · ${entry.summary}`,
    '',
    `用法：${entry.usage}`,
    '',
    '例子：',
  ];
  for (const example of entry.examples) {
    lines.push(`- \`${example.line}\` — ${example.note}`);
  }
  return lines.join('\n');
}

/** 测试与 `/help` 校验用的只读快照。 */
export function helpEntries(): HelpEntry[] {
  return ENTRIES;
}

/** 已实现的所有命令拼写（含别名），给“未知命令”的提示用。 */
export function knownCommandNames(): string[] {
  return ENTRIES.flatMap((entry) => [entry.command.replace(/^\//, ''), ...entry.aliases]);
}
