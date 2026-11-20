/**
 * 面板冒烟测试：用 jsdom 加载真实的 panel/index.html + 打包后的 main.js，
 * 确认界面能挂起来、表单字段都在、没有脚本异常。
 *
 * 面板在 iframe 之外时宿主调用会失败，这正是要覆盖的分支：出错只能落到提示条，
 * 不能抛到控制台。
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.join(import.meta.dir, '..');
const errors: string[] = [];

const html = await readFile(path.join(root, 'panel/index.html'), 'utf8');
const script = await readFile(path.join(root, 'panel/main.js'), 'utf8');

const dom = new JSDOM(html.replace(/<script[^>]*src="\.\/main\.js"[^>]*><\/script>/, ''), {
  url: 'https://openchamber.invalid/panel/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole().on('jsdomError', (error) => {
    errors.push(String(error?.message ?? error));
  }),
});

dom.window.eval(script);

afterAll(() => {
  dom.window.close();
});

describe('面板', () => {
  test('脚本加载后表单与状态区都在', () => {
    const document = dom.window.document;
    const inputs = [...document.querySelectorAll('input, textarea')];
    const labels = inputs.map((input) => input.closest('label')?.textContent ?? '');

    expect(errors).toEqual([]);
    expect(labels.join('|')).toContain('AppKey（Client ID）');
    expect(labels.join('|')).toContain('AppSecret（Client Secret）');
    expect(labels.join('|')).toContain('RobotCode');
    expect(labels.join('|')).toContain('默认项目目录');
    expect(labels.join('|')).toContain('允许的用户 staffId（可选）');

    const buttons = [...document.querySelectorAll('button')].map((button) => button.textContent?.trim());
    expect(buttons).toContain('保存并连接');
    expect(buttons).toContain('断开');
    expect(buttons).toContain('保存设置');
    expect(buttons).toContain('解除绑定');
    expect(buttons).toContain('刷新');

    expect(document.body.textContent).toContain('钉钉桥接');
    expect(document.body.textContent).toContain('未配置');
  });

  test('输入会进入草稿状态（不抛异常）', () => {
    const document = dom.window.document;
    const input = [...document.querySelectorAll('input')][0] as HTMLInputElement;
    input.value = 'dingtest';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(input.value).toBe('dingtest');
    expect(errors).toEqual([]);
  });
});
