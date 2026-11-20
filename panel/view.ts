/**
 * 面板里的纯展示逻辑：徽标、状态文案、字段提示。
 *
 * 放在 DOM 之外，方便直接测——这几行曾经把「连着但还没收到钉钉回调」错判成“连接中”，
 * 也曾经把 owner 藏在服务日志里，用户看不到谁绑定了。
 */

export type StreamStatusView = {
  state: string;
  connected: boolean;
  registered: boolean;
  lastError: string | null;
  messages: number;
};

export type StatusPayload = {
  configured: boolean;
  enabled: boolean;
  clientId?: string;
  hasSecret?: boolean;
  robotCode: string;
  cardTemplate: boolean;
  directory: string;
  allowedUsers: string[];
  notifyOtherSessions: boolean;
  ownerUserId: string | null;
  stream: StreamStatusView | null;
  binding: { userId: string; sessionId: string; title: string; directory: string; since: number } | null;
  pending: Array<{ kind: string; title: string }>;
  activity: Array<{ at: number; kind: string; text: string }>;
};

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export type BadgeView = { label: string; tone: BadgeTone };

export function stateLabel(state: string | null | undefined): string {
  switch (state) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'reconnecting':
      return '重连中';
    case 'stopped':
      return '已停止';
    case 'failed':
      return '连接失败';
    case 'idle':
      return '未启动';
    default:
      return state ? state : '未知';
  }
}

/**
 * 徽标只看“连上没有”：`registered` 要等钉钉推一条消息才为真，
 * 用它当条件会让刚连上的桥接一直显示“连接中”。
 */
export function connectionBadge(status: StatusPayload): BadgeView {
  if (!status.configured) return { label: '未配置', tone: 'neutral' };
  if (!status.enabled) return { label: '已关闭', tone: 'neutral' };
  const stream = status.stream;
  if (stream?.connected) return { label: '已连接', tone: 'success' };
  if (stream?.lastError) return { label: '连接异常', tone: 'error' };
  if (stream) return { label: stateLabel(stream.state), tone: 'info' };
  return { label: '连接中', tone: 'info' };
}

export function statusLines(status: StatusPayload): string[] {
  const stream = status.stream;
  const connection = stream
    ? `${stateLabel(stream.state)}${stream.registered ? ' · 已注册' : ''}${stream.connected ? '' : ' · 未连接'}`
    : '服务未启动';
  const lines = [
    `机器人：${status.robotCode || '（未设置）'}`,
    `连接：${connection}`,
    `已收消息：${stream?.messages ?? 0} 条`,
  ];

  if (status.ownerUserId) lines.push(`已绑定用户：${status.ownerUserId}`);

  if (status.binding) {
    lines.push(
      `绑定会话：${status.binding.title || '未命名'}`,
      `  会话 ID：${status.binding.sessionId}`,
      `  目录：${status.binding.directory || '（未知）'}`,
    );
  } else if (!status.ownerUserId) {
    lines.push('绑定会话：还没有人绑定（在钉钉里给机器人发一条消息）');
  } else if (!status.directory) {
    lines.push('绑定会话：还没有会话（先设置下面的默认项目目录，再发一条钉钉消息）');
  } else {
    lines.push('绑定会话：还没有会话（下一条钉钉消息会新建）');
  }

  lines.push(`默认目录：${status.directory || '（未设置）'}`);
  if (status.pending.length > 0) {
    lines.push(`等你回答：${status.pending.length} 个请求（回复 1 允 / 2 拒，或按提示回答）`);
  }
  if (status.allowedUsers.length > 0) lines.push(`白名单：${status.allowedUsers.join(', ')}`);
  return lines;
}

/** 「允许的用户」下面的说明：白名单为空时，把实际绑定的那个人写出来。 */
export function allowedHelper(status: StatusPayload): string {
  if (status.ownerUserId) {
    return `当前绑定：${status.ownerUserId}；留空时只有该用户可用，多个用逗号分隔。`;
  }
  return '多个用逗号分隔；留空表示第一个发消息的人独占。';
}

/** 首次加载时默认目录的来源：服务里存的优先，其次是当前打开的项目。 */
export function initialDirectory(status: StatusPayload, currentDirectory: string | null): {
  value: string;
  prefillHint?: string;
} {
  const saved = status.directory.trim();
  if (saved) return { value: saved };
  const current = (currentDirectory ?? '').trim();
  if (!current) return { value: '' };
  return { value: current, prefillHint: '已填入当前项目目录，点「保存设置」后生效。' };
}
