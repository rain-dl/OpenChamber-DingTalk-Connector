/**
 * 钉钉斜杠命令的解析（语法对齐上游 `src/bridge/slash.ts` 与 `help-catalog.ts`）。
 *
 * 解析层不碰 I/O：输入一行文本，输出一个带参数的命令对象；认不出来就返回 null，
 * 调用方把原文转给 agent —— 这正是上游“未知 /xxx 作为文本转发”的行为。
 */

export type SlashCommand =  | { kind: 'help'; topic?: string }
  | { kind: 'status'; mode?: 'brief' | 'full' }
  | { kind: 'stop' }
  | { kind: 'next' }
  | { kind: 'session'; action: 'list'; scope: 'recent' | 'current' | 'all'; limit: number | 'all' }
  | { kind: 'session'; action: 'switch'; scope: 'all' | 'current'; target: string }
  | { kind: 'session'; action: 'new'; title?: string }
  | { kind: 'session'; action: 'status' }
  | { kind: 'workspace'; action: 'list'; limit: number | 'all' }
  | { kind: 'workspace'; action: 'status' }
  | { kind: 'workspace'; action: 'switch'; target: string }
  | { kind: 'workspace'; action: 'add'; path: string }
  | { kind: 'history'; action: 'list'; limit: number | 'all' }
  | { kind: 'history'; action: 'show'; index: number }
  | { kind: 'at'; action: 'status' }
  | { kind: 'at'; action: 'file'; path: string }
  | { kind: 'at'; action: 'remove'; index: number }
  | { kind: 'at'; action: 'clear' }
  | { kind: 'at'; action: 'session' }
  | { kind: 'merge'; mode: 'on' | 'off' | 'status' }
  | { kind: 'media'; action: 'merge'; mode: 'on' | 'off' }
  | { kind: 'media'; action: 'ref'; style: 'at' | 'path' }
  | { kind: 'media'; action: 'status' }
  | { kind: 'notify'; mode: 'on' | 'off' | 'status' }
  | { kind: 'notify'; mode: 'tasks' }
  | { kind: 'surface'; mode: 'on' | 'off' | 'status' }
  | { kind: 'raw'; mode: 'on' | 'off' | 'once' | 'status' }
  | { kind: 'card'; action: 'close-question' | 'reject-permission'; index?: number }
  | { kind: 'dropped'; command: string };

/**
 * 上游有、OpenChamber 没有对应能力、因此只回一句说明的命令。
 * 保留名字是为了不让用户以为打错了，也避免把 `/model list` 当成聊天发给 agent。
 */
export const DROPPED_COMMANDS: Record<string, string> = {
  fork: '按轮次分叉需要 DSH 的会话树，OpenChamber 没有这个接口。',
  preset: 'OpenChamber 没有 agent 预设。',
  model: '服务不能在会话中途换模型，请在 OpenChamber 里改。',
  reasoning: '推理等级请在 OpenChamber 里设置。',
  perm: '权限档请在 OpenChamber 里设置；授权请求会在钉钉里问你。',
  enter: '繁忙时排队还是插话由 OpenChamber 自己决定。',
  steps: '桥接只推送最终回复，没有执行步骤流。',
  skill: '会话技能不在扩展可读的范围内。',
  flush: '没有极简模式的暂存结论。',
  'session pin': '会话置顶是应用里的能力，扩展不能改。',
  'session unpin': '会话置顶是应用里的能力，扩展不能改。',
};

const DEFAULT_LIST = 20;
const DEFAULT_HISTORY = 5;

/** 按空白切分，但保留双引号里的空格（Windows 路径常见）。 */
export function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text.trim()) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) args.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function parseCount(value: string | undefined, fallback: number): number | 'all' {
  if (!value) return fallback;
  if (value.toLowerCase() === 'all') return 'all';
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function parseOnOff(value: string | undefined): 'on' | 'off' | 'status' {
  const body = (value ?? '').toLowerCase();
  if (body === 'on' || body === '开') return 'on';
  if (body === 'off' || body === '关') return 'off';
  return 'status';
}

/** `P1=/rq` → 第 1 张卡。返回去掉前缀后的正文与编号。 */
function splitCardPrefix(text: string): { body: string; index?: number } {
  const match = /^p(\d+)\s*=\s*(\/.*)$/i.exec(text.trim());
  if (!match) return { body: text.trim() };
  return { body: match[2] ?? '', index: Number(match[1]) };
}

export function parseSlashCommand(raw: string): SlashCommand | null {
  const { body, index: cardIndex } = splitCardPrefix(raw);
  if (!body.startsWith('/')) return null;
  const [head] = body.split(/\s+/, 1);
  const name = (head ?? '').toLowerCase().replace(/^\//, '');
  const rest = body.trim().slice(head?.length ?? 0).trim();
  const args = splitArgs(rest);

  switch (name) {
    case 'help':
    case 'h':
    case '?': {
      const topic = rest.trim();
      return topic ? { kind: 'help', topic } : { kind: 'help' };
    }
    case 'status': {
      const mode = (args[0] ?? '').toLowerCase();
      if (mode === 'brief' || mode === 'full') return { kind: 'status', mode };
      return { kind: 'status' };
    }
    case 'stop':
      return { kind: 'stop' };
    case 'next':
      return { kind: 'next' };

    case 'session':
    case 's': {
      const action = (args[0] ?? '').toLowerCase();
      if (action === 'list') {
        const scope = (args[1] ?? '').toLowerCase();
        if (scope === 'current') {
          return { kind: 'session', action: 'list', scope: 'current', limit: parseCount(args[2], DEFAULT_LIST) };
        }
        if (scope === 'all') return { kind: 'session', action: 'list', scope: 'all', limit: 'all' };
        if (!scope) return { kind: 'session', action: 'list', scope: 'all', limit: DEFAULT_LIST };
        return { kind: 'session', action: 'list', scope: 'all', limit: parseCount(scope, DEFAULT_LIST) };
      }
      if (action === 'switch') {
        const scope = (args[1] ?? '').toLowerCase() === 'current' ? 'current' : 'all';
        const target = scope === 'current' ? args[2] : args[1];
        if (!target) return null;
        return { kind: 'session', action: 'switch', scope, target };
      }
      if (action === 'new') {
        const title = args.slice(1).join(' ').trim();
        return { kind: 'session', action: 'new', ...(title ? { title } : {}) };
      }
      if (action === 'status' || !action) return { kind: 'session', action: 'status' };
      if (action === 'pin' || action === 'unpin') return { kind: 'dropped', command: `session ${action}` };
      return null;
    }

    case 'workspace':
    case 'ws': {
      const action = (args[0] ?? '').toLowerCase();
      if (action === 'list') return { kind: 'workspace', action: 'list', limit: parseCount(args[1], DEFAULT_LIST) };
      if (action === 'status' || !action) return { kind: 'workspace', action: 'status' };
      if (action === 'switch') {
        const target = args.slice(1).join(' ').trim();
        return target ? { kind: 'workspace', action: 'switch', target } : null;
      }
      if (action === 'add') {
        const path = args.slice(1).join(' ').trim();
        return path ? { kind: 'workspace', action: 'add', path } : null;
      }
      // `/ws <路径>`：上游只接受子命令，这里按“切换”处理更顺手，但语法不变。
      return null;
    }

    case 'history': {
      const action = (args[0] ?? '').toLowerCase();
      if (!action) return { kind: 'history', action: 'list', limit: DEFAULT_HISTORY };
      if (action === 'list') return { kind: 'history', action: 'list', limit: parseCount(args[1], DEFAULT_HISTORY) };
      if (action === 'show') {
        const numeric = Number(args[1]);
        return Number.isInteger(numeric) && numeric > 0 ? { kind: 'history', action: 'show', index: numeric } : null;
      }
      return null;
    }

    case 'at': {
      const action = (args[0] ?? '').toLowerCase();
      if (!action) return { kind: 'at', action: 'status' };
      if (action === 's') return { kind: 'at', action: 'session' };
      if (action === 'f') {
        const path = args.slice(1).join(' ').trim();
        return path ? { kind: 'at', action: 'file', path } : null;
      }
      if (action === 'rm' || action === 'remove') {
        const numeric = Number(args[1]);
        return Number.isInteger(numeric) && numeric > 0 ? { kind: 'at', action: 'remove', index: numeric } : null;
      }
      if (action === 'clear') return { kind: 'at', action: 'clear' };
      return null;
    }

    case 'merge':
    case 'mg':
      return { kind: 'merge', mode: parseOnOff(args[0]) };

    case 'media':
    case 'md': {
      const action = (args[0] ?? '').toLowerCase();
      if (action === 'on' || action === 'off') return { kind: 'media', action: 'merge', mode: action };
      if (action === 'at' || action === 'path') return { kind: 'media', action: 'ref', style: action };
      return { kind: 'media', action: 'status' };
    }

    case 'notify':
    case 'watch':
    case 'notice': {
      const action = (args[0] ?? '').toLowerCase();
      if (action === 'tasks') return { kind: 'notify', mode: 'tasks' };
      return { kind: 'notify', mode: parseOnOff(args[0]) };
    }

    case 'surface':
    case 'wxprompt':
      return { kind: 'surface', mode: parseOnOff(args[0]) };

    case 'raw': {
      const mode = (args[0] ?? '').toLowerCase();
      if (mode === 'on' || mode === 'off' || mode === 'once') return { kind: 'raw', mode };
      return { kind: 'raw', mode: 'status' };
    }

    case 'rq':
      return { kind: 'card', action: 'close-question', ...(cardIndex ? { index: cardIndex } : {}) };
    case 'rp':
      return { kind: 'card', action: 'reject-permission', ...(cardIndex ? { index: cardIndex } : {}) };

    default:
      if (DROPPED_COMMANDS[name]) return { kind: 'dropped', command: name };
      if (name === 'p') return { kind: 'dropped', command: 'preset' };
      if (name === 'f') return { kind: 'dropped', command: 'flush' };
      return null;
  }
}

/** `/merge on` 时正文末尾的追加/提交标记。 */
export function splitMergeSuffix(text: string): { text: string; mode: 'append' | 'submit' | 'auto' } {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith('!!')) return { text: trimmed.slice(0, -2).trimEnd(), mode: 'submit' };
  if (trimmed.endsWith('..')) return { text: trimmed.slice(0, -2).trimEnd(), mode: 'append' };
  return { text: trimmed, mode: 'auto' };
}
