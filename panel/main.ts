/**
 * 钉钉桥接面板：凭据、会话目录、连接状态。
 *
 * 页面本身没有任何网络能力，所有读写都走 `host.serviceRequest` 到本地服务。
 * AppSecret 只进不出：服务只回“已保存”，面板永远拿不到它的值。
 */

import { connectHost, HostRequestError } from '@openchamber/sdk';
import {
  applyHostReady,
  mountBadge,
  mountBanner,
  mountButton,
  mountSeparator,
  mountSwitch,
  mountText,
  mountTextField,
} from '@openchamber/sdk/ui';
import type { BannerProps } from '@openchamber/sdk/ui';

import {
  allowedHelper,
  connectionBadge,
  initialDirectory,
  statusLines,
  type StatusPayload,
} from './view.js';

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root')!;

const draft = {
  clientId: '',
  clientSecret: '',
  robotCode: '',
  cardTemplateId: '',
  directory: '',
  allowedUsers: '',
  notifyOtherSessions: false,
};

let loaded = false;
let refreshing = false;
let lastStatus: StatusPayload | null = null;
let currentDirectory: string | null = null;

const head = document.createElement('div');
head.className = 'dt-head';
const title = document.createElement('span');
title.className = 'dt-title';
title.textContent = '钉钉桥接';
head.append(title);

const bannerBox = document.createElement('div');
const statusText = document.createElement('div');
statusText.className = 'dt-status';
const activityText = document.createElement('div');
activityText.className = 'dt-activity';

root.append(head, bannerBox);

const badge = mountBadge(head, { label: '未配置', tone: 'neutral' });
let banner: ReturnType<typeof mountBanner> | null = null;

function setBanner(props: BannerProps | null): void {
  if (!props) {
    banner?.dispose();
    banner = null;
    return;
  }
  if (banner) banner.update(props);
  else banner = mountBanner(bannerBox, props);
}

// ─── 连接 ─────────────────────────────────────────────────────────────

const connectSection = document.createElement('div');
connectSection.className = 'dt-section';
const connectTitle = document.createElement('div');
connectTitle.className = 'dt-section-title';
connectTitle.textContent = '连接聊天机器人';
connectSection.append(connectTitle);
root.append(connectSection);

const clientIdField = mountTextField(connectSection, {
  label: 'AppKey（Client ID）',
  value: draft.clientId,
  placeholder: 'dingxxxxxxxx',
  mono: true,
  onChange: (value) => {
    draft.clientId = value;
  },
});

const secretField = mountTextField(connectSection, {
  label: 'AppSecret（Client Secret）',
  value: '',
  placeholder: '已保存，留空则不修改',
  password: true,
  helper: '只保存在扩展自己的数据目录里，面板不会把它读回来。',
  onChange: (value) => {
    draft.clientSecret = value;
  },
});

const robotField = mountTextField(connectSection, {
  label: 'RobotCode',
  value: draft.robotCode,
  placeholder: '留空则和 AppKey 相同',
  mono: true,
  onChange: (value) => {
    draft.robotCode = value;
  },
});

const cardField = mountTextField(connectSection, {
  label: '卡片模板 ID（可选）',
  value: draft.cardTemplateId,
  placeholder: '留空使用内置 AI 卡片模板',
  mono: true,
  onChange: (value) => {
    draft.cardTemplateId = value;
  },
});

const connectRow = document.createElement('div');
connectRow.className = 'dt-row';
connectSection.append(connectRow);

const saveButton = mountButton(connectRow, {
  label: '保存并连接',
  variant: 'default',
  onClick: () => void save(),
});

const disconnectButton = mountButton(connectRow, {
  label: '断开',
  variant: 'outline',
  onClick: () => void post('/disconnect'),
});

// ─── 会话 ─────────────────────────────────────────────────────────────

mountSeparator(root, { label: '会话' });

const sessionSection = document.createElement('div');
sessionSection.className = 'dt-section';
const sessionTitle = document.createElement('div');
sessionTitle.className = 'dt-section-title';
sessionTitle.textContent = '会话';
sessionSection.append(sessionTitle);
root.append(sessionSection);

const directoryField = mountTextField(sessionSection, {
  label: '默认项目目录',
  value: draft.directory,
  placeholder: 'D:\\Workspace\\项目',
  mono: true,
  helper: '第一条钉钉消息会在这个目录里新建会话。',
  onChange: (value) => {
    draft.directory = value;
  },
});

const useDirectoryButton = mountButton(sessionSection, {
  label: '用当前项目',
  variant: 'ghost',
  size: 'sm',
  onClick: () => {
    if (!currentDirectory) {
      void host.toast({ kind: 'info', message: '还没有打开任何项目，请先打开一个项目或手动填写目录。' });
      return;
    }
    draft.directory = currentDirectory;
    directoryField.update({ value: draft.directory });
  },
});

const allowedField = mountTextField(sessionSection, {
  label: '允许的用户 staffId（可选）',
  value: '',
  placeholder: '留空表示第一个发消息的人独占',
  helper: '多个用逗号分隔；填了就只回应这些人。',
  onChange: (value) => {
    draft.allowedUsers = value;
  },
});

const pinUserButton = mountButton(sessionSection, {
  label: '填入当前绑定用户',
  variant: 'ghost',
  size: 'sm',
  disabled: true,
  onClick: () => {
    const owner = lastStatus?.ownerUserId;
    if (!owner) return;
    draft.allowedUsers = owner;
    allowedField.update({ value: owner });
  },
});

const notifySwitch = mountSwitch(sessionSection, {
  label: '其它会话结束时也提醒我',
  checked: false,
  description: '包括你在 OpenChamber 里手动开的会话；默认只推绑定的那个。',
  onChange: (checked) => {
    draft.notifyOtherSessions = checked;
    notifySwitch.update({ checked });
  },
});

const sessionRow = document.createElement('div');
sessionRow.className = 'dt-row';
sessionSection.append(sessionRow);

mountButton(sessionRow, {
  label: '保存设置',
  variant: 'secondary',
  onClick: () => void save(),
});

mountButton(sessionRow, {
  label: '解除绑定',
  variant: 'outline',
  onClick: () => void post('/unbind'),
});

// ─── 状态 ─────────────────────────────────────────────────────────────

mountSeparator(root, { label: '状态' });
root.append(statusText);
root.append(activityText);

const statusRow = document.createElement('div');
statusRow.className = 'dt-row';
root.append(statusRow);

mountButton(statusRow, {
  label: '刷新',
  variant: 'ghost',
  size: 'sm',
  onClick: () => void refresh(),
});

const hint = document.createElement('div');
hint.className = 'dt-hint';
hint.textContent = '在钉钉里发 /help 看命令；直接发消息就是给 agent 的新指令；agent 也能用 send_dingtalk 主动发消息或文件。';
root.append(hint);

// ─── 与服务的往返 ─────────────────────────────────────────────────────

async function request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<StatusPayload> {
  const result = await host.serviceRequest({
    method,
    path,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`服务返回 ${result.status}`);
  }
  return JSON.parse(result.body) as StatusPayload;
}

function errorMessage(error: unknown): string {
  if (error instanceof HostRequestError) {
    if (error.code === 'NO_SERVICE') return '本地服务还没启动或没有授权。到设置 → 扩展里确认已批准。';
    if (error.code === 'SERVICE_FAILED') return '本地服务启动失败，稍后重试。';
  }
  return error instanceof Error ? error.message : String(error);
}

async function post(path: string): Promise<void> {
  try {
    const status = await request(path, 'POST', {});
    apply(status);
    await host.toast({ kind: 'success', message: path === '/unbind' ? '已解除绑定' : '已断开连接' });
  } catch (error) {
    setBanner({ tone: 'error', title: '操作失败', body: errorMessage(error) });
  }
}

async function save(): Promise<void> {
  saveButton.update({ loading: true });
  try {
    const payload: Record<string, unknown> = {
      clientId: draft.clientId,
      robotCode: draft.robotCode,
      cardTemplateId: draft.cardTemplateId,
      directory: draft.directory,
      allowedUsers: draft.allowedUsers,
      enabled: true,
      notifyOtherSessions: draft.notifyOtherSessions,
    };
    if (draft.clientSecret.trim()) payload.clientSecret = draft.clientSecret;
    const status = await request('/config', 'POST', payload);
    draft.clientSecret = '';
    secretField.update({ value: '', error: undefined });
    apply(status);
    loaded = true;
    await host.toast({ kind: 'success', message: '已保存' });
  } catch (error) {
    setBanner({ tone: 'error', title: '保存失败', body: errorMessage(error) });
  } finally {
    saveButton.update({ loading: false });
  }
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const status = await request('/status', 'GET');
    apply(status);
  } catch (error) {
    setBanner({ tone: 'warning', title: '读不到服务状态', body: errorMessage(error) });
  } finally {
    refreshing = false;
  }
}

/** 把服务返回的状态画到面板上；只在第一次填充表单，免得覆盖正在输入的内容。 */
function apply(status: StatusPayload): void {
  lastStatus = status;
  if (!loaded) {
    loaded = true;
    const directory = initialDirectory(status, currentDirectory);
    draft.clientId = status.clientId ?? '';
    draft.robotCode = status.robotCode ?? '';
    draft.directory = directory.value;
    draft.allowedUsers = status.allowedUsers.join(', ');
    draft.notifyOtherSessions = status.notifyOtherSessions;
    clientIdField.update({ value: draft.clientId });
    robotField.update({ value: draft.robotCode });
    directoryField.update({
      value: draft.directory,
      ...(directory.prefillHint ? { helper: directory.prefillHint } : {}),
    });
    allowedField.update({ value: draft.allowedUsers });
    notifySwitch.update({ checked: draft.notifyOtherSessions });
    secretField.update({ placeholder: status.hasSecret ? '已保存，留空则不修改' : '填 AppSecret' });
  }

  // 绑定用户变了要让用户看见：说明文字和「填入」按钮每次都跟着刷新。
  allowedField.update({ helper: allowedHelper(status) });
  pinUserButton.update({ disabled: !status.ownerUserId });

  const stream = status.stream;
  badge.update(connectionBadge(status));
  if (!status.configured) {
    setBanner({
      tone: 'info',
      title: '先填三项',
      body: '在钉钉开放平台建一个企业内部应用，加上机器人并选择 Stream 模式，然后把 AppKey、AppSecret、RobotCode 填在这里。',
    });
  } else if (!status.enabled) {
    setBanner({ tone: 'warning', title: '桥接已关闭', body: '点「保存并连接」会重新连上钉钉。' });
  } else if (!stream?.connected && stream?.lastError) {
    setBanner({
      tone: 'error',
      title: '连不上钉钉',
      body: `${stream.lastError}\n检查 AppKey / AppSecret，以及这台机器能否访问 api.dingtalk.com。`,
    });
  } else if (status.ownerUserId && !status.binding && !status.directory) {
    setBanner({
      tone: 'warning',
      title: '还差默认项目目录',
      body: `钉钉用户 ${status.ownerUserId} 已经和机器人说上话，但没有目录就没法建会话：在下面选好项目目录并「保存设置」，再在钉钉里发一条消息。`,
    });
  } else {
    setBanner(null);
  }

  statusText.textContent = statusLines(status).join('\n');

  const activity = status.activity.slice(0, 6).map((entry) => {
    const time = new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false });
    return `${time} · ${entry.text}`;
  });
  activityText.textContent = activity.length > 0 ? ['', '最近动态', ...activity].join('\n') : '';
}

// ─── 启动 ─────────────────────────────────────────────────────────────

host.onDirectory((directory) => {
  currentDirectory = directory;
  // 还没填过目录时，打开的项目就是最合理的默认值；只填空的，绝不覆盖用户输入。
  if (directory && !draft.directory.trim()) {
    draft.directory = directory;
    directoryField.update({
      value: directory,
      helper: '已填入当前项目目录，点「保存设置」后生效。',
    });
  }
});

host.onServiceEvent((event) => {
  if (event.topic === 'state') void refresh();
});

let mounted = false;
host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  currentDirectory = context.directory ?? currentDirectory ?? null;
  if (mounted) return;
  mounted = true;
  void refresh();
});

// 服务空闲十分钟会被宿主停掉，重新打开面板时顶部状态可能过期；点“刷新”即可。
window.addEventListener('focus', () => {
  if (lastStatus) void refresh();
});
