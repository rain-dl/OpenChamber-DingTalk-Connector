/**
 * 钉钉侧的渲染与解析：把宿主推来的“授权请求 / 提问表单”画成钉钉消息，
 * 再把用户在钉钉里的回复解析回 `answerPermission` / `answerForm` 需要的形状。
 *
 * 这一层不做任何 I/O，纯函数，方便测试。
 */

import type {
  GuestFormField,
  GuestPermissionAskedContent,
  GuestQuestionAskedContent,
} from '@openchamber/sdk';

const RESOURCE_MAX = 6;

function trim(value: string | null | undefined, max: number): string {
  const body = (value ?? '').trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function sessionLabel(sessionTitle: string | null): string {
  return trim(sessionTitle, 40) || '当前会话';
}

/** 授权请求 → 钉钉 markdown。 */
export function renderPermissionAsk(content: GuestPermissionAskedContent): string {
  const resources = content.resources.slice(0, RESOURCE_MAX).map((item) => `- \`${trim(item, 120)}\``);
  if (content.resources.length > RESOURCE_MAX) {
    resources.push(`- …另有 ${content.resources.length - RESOURCE_MAX} 项`);
  }
  return [
    `🔐 **需要授权** · ${sessionLabel(content.sessionTitle)}`,
    '',
    `动作：\`${trim(content.action, 80)}\``,
    ...(resources.length > 0 ? ['资源：', ...resources] : []),
    ...(content.message ? ['', `说明：${trim(content.message, 300)}`] : []),
    '',
    '回复 **1** 允许一次，**2** 拒绝（也可以直接回复拒绝理由）。',
  ].join('\n');
}

/** 表单字段 → 一行可读说明。 */
function renderField(field: GuestFormField, index: number): string {
  const required = field.required ? '（必填）' : '';
  const description = field.description ? ` — ${trim(field.description, 120)}` : '';
  if (field.options && field.options.length > 0) {
    const options = field.options.map((option, optionIndex) => `${optionIndex + 1}.${trim(option.label, 40)}`).join(' / ');
    return `${index + 1}. **${trim(field.title, 60)}**${required}：${options}${description}`;
  }
  if (field.type === 'boolean') {
    return `${index + 1}. **${trim(field.title, 60)}**${required}：是 / 否${description}`;
  }
  if (field.type === 'number' || field.type === 'integer') {
    return `${index + 1}. **${trim(field.title, 60)}**${required}：数字${description}`;
  }
  if (field.type === 'external') {
    return `${index + 1}. **${trim(field.title, 60)}**：需要你在 OpenChamber 里打开链接完成${description}`;
  }
  return `${index + 1}. **${trim(field.title, 60)}**${required}：文本${description}`;
}

/** 提问（表单或页面）→ 钉钉 markdown。 */
export function renderQuestionAsk(content: GuestQuestionAskedContent): string {
  const header = `❓ **${trim(content.ask.title, 80) || '需要你回答'}** · ${sessionLabel(content.sessionTitle)}`;
  if (content.ask.kind === 'page') {
    return [header, '', '这个问题要在 OpenChamber 窗口里回答；直接回复文字会作为新消息发给 agent。'].join('\n');
  }
  const fields = content.ask.fields;
  const multiple = fields.length > 1;
  return [
    header,
    '',
    ...fields.map(renderField),
    '',
    multiple
      ? '回复格式：每行一项 `1=选项` 或 `字段名=值`。'
      : '回复序号或内容即可。',
  ].join('\n');
}

export type PermissionAnswer = { decision: 'allow' | 'deny'; message?: string };

const ALLOW_WORDS = new Set(['1', 'y', 'yes', 'ok', 'allow', '允许', '同意', '批准', '好的', '可以']);
const DENY_WORDS = new Set(['2', 'n', 'no', 'deny', 'reject', '拒绝', '不允许', '不行']);

/** 明确的允许/拒绝；其它文字一律不算回答（它会作为新消息发给 agent）。 */
export function parsePermissionAnswer(text: string): PermissionAnswer | null {
  const body = text.trim().toLowerCase();
  if (!body) return null;
  if (ALLOW_WORDS.has(body)) return { decision: 'allow' };
  if (DENY_WORDS.has(body)) return { decision: 'deny', message: '已在钉钉中拒绝' };
  const prefixed = /^(?:拒绝|deny|reject)[:：\s]+(.+)$/s.exec(body);
  if (prefixed?.[1]) return { decision: 'deny', message: prefixed[1].slice(0, 2_000) };
  return null;
}

export type FormAnswers =
  | { ok: true; values: Record<string, string | number | boolean | string[]> }
  | { ok: false; error: string };

function matchOption(field: GuestFormField, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const options = field.options ?? [];
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
    return options[numeric - 1]?.value ?? null;
  }
  const byLabel = options.find((option) => option.label.trim().toLowerCase() === value.toLowerCase());
  if (byLabel) return byLabel.value;
  const byValue = options.find((option) => option.value.toLowerCase() === value.toLowerCase());
  return byValue ? byValue.value : null;
}

function parseBool(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (['是', '对', 'y', 'yes', 'true', '1', '同意', '允许'].includes(value)) return true;
  if (['否', '不', 'n', 'no', 'false', '0', '拒绝'].includes(value)) return false;
  return null;
}

/** 一个字段的一串输入 → 值；不合法时给出给用户看的原因。 */
function parseField(field: GuestFormField, raw: string): { value: string | number | boolean | string[] } | { error: string } {
  const body = raw.trim();
  if (!body) return { error: `「${field.title}」不能为空` };
  if (field.type === 'boolean') {
    const parsed = parseBool(body);
    return parsed === null ? { error: `「${field.title}」请回答 是 / 否` } : { value: parsed };
  }
  if (field.type === 'number' || field.type === 'integer') {
    const numeric = Number(body);
    if (!Number.isFinite(numeric)) return { error: `「${field.title}」需要一个数字` };
    return { value: field.type === 'integer' ? Math.round(numeric) : numeric };
  }
  if (field.options && field.options.length > 0) {
    if (field.type === 'multiselect') {
      const parts = body.split(/[,，、\s]+/).filter(Boolean);
      const values: string[] = [];
      for (const part of parts) {
        const matched = matchOption(field, part);
        if (!matched) {
          if (field.custom) values.push(part);
          else return { error: `「${field.title}」没有选项“${trim(part, 30)}”` };
        } else {
          values.push(matched);
        }
      }
      if (values.length === 0) return { error: `「${field.title}」至少选一项` };
      return { value: values };
    }
    const matched = matchOption(field, body);
    if (!matched) {
      if (field.custom) return { value: body };
      const hint = field.options.map((option, index) => `${index + 1}.${option.label}`).join(' / ');
      return { error: `「${field.title}」请回复序号或选项：${hint}` };
    }
    return { value: matched };
  }
  return { value: body };
}

function whenHolds(field: GuestFormField, values: Record<string, unknown>): boolean {
  if (!field.when || field.when.length === 0) return true;
  return field.when.every((clause) => {
    const current = values[clause.key];
    return clause.op === 'eq' ? current === clause.value : current !== clause.value;
  });
}

/**
 * 解析一条回复。多条字段时支持 `key=值` / `标题=值` 每行一项；
 * 只有一条字段（或用户只给了一行）时，整条回复就是那一项的值。
 */
export function parseFormAnswer(fields: GuestFormField[], text: string): FormAnswers {
  const answerable = fields.filter((field) => field.type !== 'external');
  if (answerable.length === 0) {
    return { ok: false, error: '这个问题需要在 OpenChamber 里回答。' };
  }
  const body = text.trim();
  if (!body) return { ok: false, error: '回复内容为空。' };

  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const inline = new Map<string, string>();
  for (const line of lines) {
    const match = /^([^=＝]+)[=＝](.*)$/s.exec(line);
    if (!match) continue;
    const key = match[1]?.trim().toLowerCase() ?? '';
    inline.set(key, match[2] ?? '');
  }

  if (answerable.length === 1) {
    const field = answerable[0]!;
    const single = field.key.toLowerCase();
    const titled = field.title.trim().toLowerCase();
    const raw = inline.get(single) ?? inline.get(titled) ?? body;
    const parsed = parseField(field, raw);
    return 'error' in parsed
      ? { ok: false, error: parsed.error }
      : { ok: true, values: { [field.key]: parsed.value } };
  }

  if (inline.size === 0) {
    return {
      ok: false,
      error: `有 ${answerable.length} 个字段，请按「字段=值」每行一行回复，例如：${answerable[0]!.title}=值`,
    };
  }

  const values: Record<string, string | number | boolean | string[]> = {};
  for (const field of answerable) {
    if (!whenHolds(field, values)) continue;
    const key = field.key.toLowerCase();
    const titled = field.title.trim().toLowerCase();
    const raw = inline.get(key) ?? inline.get(titled);
    if (raw === undefined) {
      if (field.required) return { ok: false, error: `缺少必填字段「${field.title}」` };
      continue;
    }
    const parsed = parseField(field, raw);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    values[field.key] = parsed.value;
  }
  if (Object.keys(values).length === 0) return { ok: false, error: '没有识别到任何字段，请用「字段=值」格式。' };
  return { ok: true, values };
}
