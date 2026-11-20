/**
 * OpenCode 只读访问（`service.provides: ["opencode"]` 的授权）。
 *
 * 只做三件事：列项目、列会话、读一个会话的消息。宿主在环境变量里给地址，
 * 令牌就是服务自己的 bearer；地址缺失说明用户没批这个权限，命令要如实说明。
 */

export type OcProject = { id: string; worktree: string };

export type OcSession = {
  id: string;
  title: string;
  directory: string;
  updatedAt: number;
};

export type OcTurn = {
  /** 用户这一轮的提问（已 trim）。 */
  user: string;
  /** 助手这一轮的最终文字（可能为空）。 */
  reply: string;
  at: number;
};

export type OpenCodeReader = {
  listProjects(): Promise<OcProject[]>;
  listSessions(options?: { directory?: string }): Promise<OcSession[]>;
  listTurns(sessionId: string): Promise<OcTurn[]>;
};

const REQUEST_TIMEOUT_MS = 10_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['data', 'items', 'sessions', 'projects', 'messages']) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

function partText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const chunks: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string' && record.text.trim()) {
      chunks.push(record.text.trim());
    }
  }
  return chunks.join('\n\n').trim();
}

export function createOpenCodeReader(env: NodeJS.ProcessEnv = process.env): OpenCodeReader | null {
  const baseUrl = text(env.OPENCHAMBER_OPENCODE_URL);
  const token = text(env.OPENCHAMBER_SERVICE_TOKEN);
  if (!baseUrl || !token) return null;

  const get = async (path: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenCode 返回 ${response.status}${body ? `：${body.slice(0, 120)}` : ''}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('读取 OpenCode 超时');
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  };

  const listProjects = async (): Promise<OcProject[]> => {
    const raw = asArray(await get('/api/project'));
    const projects: OcProject[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const worktree = text(record.worktree) || text(record.directory) || text(record.path);
      if (!worktree) continue;
      projects.push({ id: text(record.id) || worktree, worktree });
    }
    return projects.sort((a, b) => a.worktree.localeCompare(b.worktree));
  };

  const listSessions = async (options: { directory?: string } = {}): Promise<OcSession[]> => {
    const raw = asArray(await get('/api/session'));
    const sessions: OcSession[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const id = text(record.id);
      if (!id) continue;
      // 子会话（subagent）不是用户能切过去的对话。
      if (text(record.parentID) || text(record.parentId)) continue;
      const directory = text(record.directory);
      if (options.directory && directory && directory !== options.directory) continue;
      const time = (record.time && typeof record.time === 'object' ? record.time : {}) as Record<string, unknown>;
      const updated = Number(time.updated ?? time.created ?? 0);
      sessions.push({
        id,
        title: text(record.title) || '未命名会话',
        directory,
        updatedAt: Number.isFinite(updated) ? updated : 0,
      });
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const listTurns = async (sessionId: string): Promise<OcTurn[]> => {
    const raw = asArray(await get(`/api/session/${encodeURIComponent(sessionId)}/message`));
    const turns: OcTurn[] = [];
    let current: OcTurn | null = null;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const info = (record.info && typeof record.info === 'object' ? record.info : {}) as Record<string, unknown>;
      const role = text(info.role);
      const at = Number((info.time as Record<string, unknown> | undefined)?.created ?? 0);
      const body = partText(record.parts);
      if (role === 'user') {
        if (current) turns.push(current);
        current = { user: body, reply: '', at: Number.isFinite(at) ? at : Date.now() };
      } else if (role === 'assistant' && current) {
        if (body) current.reply = body;
      }
    }
    if (current) turns.push(current);
    return turns;
  };

  return { listProjects, listSessions, listTurns };
}
