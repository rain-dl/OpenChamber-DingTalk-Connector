/**
 * OpenCode 只读访问（`service.provides: ["opencode"]` 的授权）。
 *
 * 真实形状（对着 2.7.3 宿主里的 OpenCode 2.3.2 抓过）：
 *
 *   GET /api/project        → [{ id, canonical: "D:\\path", vcs, … }, …]
 *   GET /api/session        → { data: [ { id, title, outcome, time:{updated,busy,idle,archived}, location:{directory} } ], cursor }
 *   GET /api/session/active → { data: { "ses_…": { "type": "running" } } }
 *   GET /api/session/:id/message → [ { info: { role, time }, parts: [ { type: "text", text } ] } ]
 *
 * 两个坑都来自这层形状：
 * - 目录在 `canonical` / `location.directory`，不是 `worktree` / `directory`；
 * - “正在运行”是 active 接口的 id 表，会话本身没有 running 字段。
 */

export type OcProject = { id: string; worktree: string };

export type OcSession = {
  id: string;
  title: string;
  directory: string;
  updatedAt: number;
  outcome: string;
};

export type OcTurn = {
  /** 用户这一轮的提问（已 trim）。 */
  user: string;
  /** 助手这一轮的最终文字（可能为空）。 */
  reply: string;
  at: number;
};

export type ListSessionsOptions = {
  directory?: string;
  /** 只列正在运行的会话（`/api/session/active`）。 */
  activeOnly?: boolean;
};

export type OpenCodeReader = {
  listProjects(): Promise<OcProject[]>;
  listSessions(options?: ListSessionsOptions): Promise<OcSession[]>;
  listTurns(sessionId: string): Promise<OcTurn[]>;
};

const REQUEST_TIMEOUT_MS = 10_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 接口可能给数组，也可能包一层 `{ data: [...] }`。 */
function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['data', 'items', 'sessions', 'projects', 'messages']) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/** `/api/session/active` 的 `{ data: { id: {...} } }` → id 集合。 */
function activeIds(value: unknown): Set<string> {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const body = record.data ?? record;
  const ids = new Set<string>();
  if (Array.isArray(body)) {
    for (const item of body) {
      if (typeof item === 'string') ids.add(item);
      else if (item && typeof item === 'object') {
        const id = text((item as Record<string, unknown>).id) || text((item as Record<string, unknown>).sessionID);
        if (id) ids.add(id);
      }
    }
    return ids;
  }
  if (body && typeof body === 'object') {
    for (const [id, info] of Object.entries(body as Record<string, unknown>)) {
      if (!id || !info || typeof info !== 'object') continue;
      const type = text((info as Record<string, unknown>).type);
      if (!type || type === 'running') ids.add(id);
    }
  }
  return ids;
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

/** 快捷聊天目录（`…/openchamber/chats/<日期>/session-…`）不是项目。 */
function isChatDirectory(directory: string): boolean {
  return /(^|[\\/])openchamber[\\/]chats([\\/]|$)/i.test(directory);
}

/** 去掉明显不是项目根的路径：全局项目 `/`、空串。 */
function isUsableProject(directory: string): boolean {
  const body = directory.trim();
  if (!body || body === '/' || body === '\\') return false;
  return !isChatDirectory(body);
}

function normalizeForCompare(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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

  const parseSession = (item: unknown): OcSession | null => {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const id = text(record.id);
    if (!id) return null;
    // 子会话（subagent）不是用户能切过去的对话。
    if (text(record.parentID) || text(record.parentId)) return null;
    const time = (record.time && typeof record.time === 'object' ? record.time : {}) as Record<string, unknown>;
    // 归档的会话不返回：列表是用来继续对话的。
    if (time.archived) return null;
    const location = (record.location && typeof record.location === 'object' ? record.location : {}) as Record<string, unknown>;
    const updated = Number(time.updated ?? time.created ?? 0);
    return {
      id,
      title: text(record.title) || '未命名会话',
      directory: text(location.directory) || text(record.directory),
      updatedAt: Number.isFinite(updated) ? updated : 0,
      outcome: text(record.outcome),
    };
  };

  const readSessions = async (path: string): Promise<OcSession[]> => {
    const raw = asList(await get(path));
    return raw
      .map(parseSession)
      .filter((session): session is OcSession => session !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const listSessions = async (options: ListSessionsOptions = {}): Promise<OcSession[]> => {
    if (options.activeOnly) {
      // “正在运行”只有 id 表，标题和时间要从会话列表里补。
      const running = activeIds(await get('/api/session/active'));
      if (running.size === 0) return [];
      const all = await readSessions('/api/session');
      return all.filter((session) => running.has(session.id));
    }
    const sessions = await readSessions('/api/session');
    if (!options.directory) return sessions;
    return sessions.filter((session) => !session.directory || session.directory === options.directory);
  };

  /**
   * 项目列表：`/api/project` 优先，再用会话目录兜底。
   * 2.7.3 宿主里目录字段叫 `canonical`，早期实现叫 worktree，
   * 所以这里按 canonical → worktree → directory → path 依次取。
   */
  const listProjects = async (): Promise<OcProject[]> => {
    const found = new Map<string, OcProject>();

    try {
      for (const item of asList(await get('/api/project'))) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const worktree = text(record.canonical) || text(record.worktree) || text(record.directory) || text(record.path);
        if (!isUsableProject(worktree)) continue;
        found.set(normalizeForCompare(worktree), { id: text(record.id) || worktree, worktree });
      }
    } catch {
      // 项目接口不可用时仍然用会话目录兜底，不让 /ws list 变成空的。
    }

    if (found.size === 0) {
      try {
        for (const session of await readSessions('/api/session')) {
          if (!isUsableProject(session.directory)) continue;
          const key = normalizeForCompare(session.directory);
          if (!found.has(key)) found.set(key, { id: session.directory, worktree: session.directory });
        }
      } catch {
        // 两边都读不到就返回空，由命令层解释。
      }
    }

    return [...found.values()].sort((a, b) => a.worktree.localeCompare(b.worktree));
  };

  const listTurns = async (sessionId: string): Promise<OcTurn[]> => {
    const raw = asList(await get(`/api/session/${encodeURIComponent(sessionId)}/message`));
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
