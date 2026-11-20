import { describe, expect, test } from 'bun:test';

import {
  parseFormAnswer,
  parsePermissionAnswer,
  renderPermissionAsk,
  renderQuestionAsk,
} from '../service/format.js';

describe('授权请求', () => {
  test('渲染出动作与回复提示', () => {
    const text = renderPermissionAsk({
      type: 'permission-asked',
      sessionTitle: '修复解析器',
      action: 'bash',
      resources: ['npm test', 'npm run build'],
      message: '需要执行测试',
    });
    expect(text).toContain('需要授权');
    expect(text).toContain('修复解析器');
    expect(text).toContain('`bash`');
    expect(text).toContain('npm test');
    expect(text).toContain('回复 **1** 允许一次');
  });

  test('资源过多时收敛成一行', () => {
    const text = renderPermissionAsk({
      type: 'permission-asked',
      sessionTitle: null,
      action: 'edit',
      resources: Array.from({ length: 9 }, (_, index) => `file-${index}.ts`),
      message: null,
    });
    expect(text).toContain('另有 3 项');
  });

  test('允许与拒绝的写法', () => {
    expect(parsePermissionAnswer('1')).toEqual({ decision: 'allow' });
    expect(parsePermissionAnswer('允许')).toEqual({ decision: 'allow' });
    expect(parsePermissionAnswer('Yes')).toEqual({ decision: 'allow' });
    expect(parsePermissionAnswer('2')?.decision).toBe('deny');
    expect(parsePermissionAnswer('拒绝')).toEqual({ decision: 'deny', message: '已在钉钉中拒绝' });
    expect(parsePermissionAnswer('拒绝：路径不对')).toEqual({ decision: 'deny', message: '路径不对' });
  });

  test('普通文字不算回答', () => {
    expect(parsePermissionAnswer('先别动，我去看看')).toBeNull();
    expect(parsePermissionAnswer('')).toBeNull();
  });
});

describe('提问表单', () => {
  const choice = {
    key: 'color',
    type: 'string' as const,
    title: '选个颜色',
    description: null,
    required: true,
    options: [
      { value: 'red', label: '红色' },
      { value: 'blue', label: '蓝色' },
    ],
  };

  test('渲染选项与回复提示', () => {
    const text = renderQuestionAsk({
      type: 'question-asked',
      sessionTitle: '配色',
      ask: { kind: 'form', id: 'frm_1', title: '选一个颜色', fields: [choice] },
    });
    expect(text).toContain('选一个颜色');
    expect(text).toContain('1.红色');
    expect(text).toContain('回复序号或内容即可');
  });

  test('页面型提问只能去应用里回答', () => {
    const text = renderQuestionAsk({
      type: 'question-asked',
      sessionTitle: null,
      ask: { kind: 'page', id: 'page_1', title: '填个表' },
    });
    expect(text).toContain('要在 OpenChamber 窗口里回答');
  });

  test('单字段：序号、标签、值都能识别', () => {
    expect(parseFormAnswer([choice], '2')).toEqual({ ok: true, values: { color: 'blue' } });
    expect(parseFormAnswer([choice], '红色')).toEqual({ ok: true, values: { color: 'red' } });
    expect(parseFormAnswer([choice], 'blue')).toEqual({ ok: true, values: { color: 'blue' } });
    expect(parseFormAnswer([choice], '3')).toEqual({ ok: false, error: '「选个颜色」请回复序号或选项：1.红色 / 2.蓝色' });
  });

  test('多字段：字段=值', () => {
    const fields = [
      choice,
      { key: 'note', type: 'string' as const, title: '备注', description: null, required: false },
      { key: 'count', type: 'integer' as const, title: '数量', description: null, required: true },
    ];
    expect(parseFormAnswer(fields, '选个颜色=1\n数量=3\n备注=第 3 版')).toEqual({
      ok: true,
      values: { color: 'red', note: '第 3 版', count: 3 },
    });
    expect(parseFormAnswer(fields, '选个颜色=1')).toEqual({ ok: false, error: '缺少必填字段「数量」' });
    expect(parseFormAnswer(fields, '随便')).toEqual({
      ok: false,
      error: '有 3 个字段，请按「字段=值」每行一行回复，例如：选个颜色=值',
    });
  });

  test('布尔与多选', () => {
    const toggle = { key: 'yes', type: 'boolean' as const, title: '继续吗', description: null, required: true };
    expect(parseFormAnswer([toggle], '是')).toEqual({ ok: true, values: { yes: true } });
    expect(parseFormAnswer([toggle], '不')).toEqual({ ok: true, values: { yes: false } });
    expect(parseFormAnswer([toggle], '也许')?.ok).toBe(false);

    const multi = { ...choice, key: 'colors', type: 'multiselect' as const, title: '颜色们' };
    expect(parseFormAnswer([multi], '1,2')).toEqual({ ok: true, values: { colors: ['red', 'blue'] } });
  });

  test('条件字段不满足时跳过', () => {
    const fields = [
      { key: 'mode', type: 'string' as const, title: '模式', description: null, required: true, options: [{ value: 'a', label: 'A' }] },
      {
        key: 'extra',
        type: 'string' as const,
        title: '补充',
        description: null,
        required: true,
        when: [{ key: 'mode', op: 'eq' as const, value: 'b' }],
      },
    ];
    expect(parseFormAnswer(fields, '模式=A')).toEqual({ ok: true, values: { mode: 'a' } });
  });

  test('只有外部链接字段时提示去应用里回答', () => {
    const only = [{ key: 'link', type: 'external' as const, title: '打开链接', description: null, required: true }];
    expect(parseFormAnswer(only, '好的')).toEqual({ ok: false, error: '这个问题需要在 OpenChamber 里回答。' });
  });
});
