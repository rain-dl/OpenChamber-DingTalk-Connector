/**
 * 命令语法必须与上游 dsh-dingtalk 一致，所以这里用“目录里的例子必须都能解析”
 * 做防漂移检查：帮助里写出来的每一行都是解析器真的认的。
 */

import { describe, expect, test } from 'bun:test';

import { helpEntries } from '../service/catalog.js';
import { parseSlashCommand, splitArgs, splitMergeSuffix } from '../service/slash.js';

describe('参数切分', () => {
  test('双引号里保留空格', () => {
    expect(splitArgs('f "D:\\my docs\\spec.md"')).toEqual(['f', 'D:\\my docs\\spec.md']);
    expect(splitArgs('  list   current  ')).toEqual(['list', 'current']);
  });
});

describe('目录里的每个命令例子都能解析', () => {
  for (const entry of helpEntries()) {
    for (const example of entry.examples) {
      if (example.kind === 'text') continue;
      test(`${entry.command} → ${example.line}`, () => {
        expect(parseSlashCommand(example.line)).not.toBeNull();
      });
    }
  }
});

describe('命令与别名', () => {
  test('help 的三种写法与主题', () => {
    expect(parseSlashCommand('/help')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('/h')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('/?')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('/help s')).toEqual({ kind: 'help', topic: 's' });
    expect(parseSlashCommand('/help 多 个 词')).toEqual({ kind: 'help', topic: '多 个 词' });
  });

  test('status 的 brief / full', () => {
    expect(parseSlashCommand('/status')).toEqual({ kind: 'status' });
    expect(parseSlashCommand('/status brief')).toEqual({ kind: 'status', mode: 'brief' });
    expect(parseSlashCommand('/status full')).toEqual({ kind: 'status', mode: 'full' });
    expect(parseSlashCommand('/status now')).toEqual({ kind: 'status' });
  });

  test('session：list / switch / new / status', () => {
    expect(parseSlashCommand('/s')).toEqual({ kind: 'session', action: 'status' });
    expect(parseSlashCommand('/session list')).toEqual({ kind: 'session', action: 'list', scope: 'recent', limit: 20 });
    expect(parseSlashCommand('/s list current')).toEqual({ kind: 'session', action: 'list', scope: 'current', limit: 20 });
    expect(parseSlashCommand('/s list all')).toEqual({ kind: 'session', action: 'list', scope: 'all', limit: 'all' });
    expect(parseSlashCommand('/s list 5')).toEqual({ kind: 'session', action: 'list', scope: 'all', limit: 5 });
    expect(parseSlashCommand('/s switch 3')).toEqual({ kind: 'session', action: 'switch', scope: 'all', target: '3' });
    expect(parseSlashCommand('/s switch current 2')).toEqual({ kind: 'session', action: 'switch', scope: 'current', target: '2' });
    expect(parseSlashCommand('/s new')).toEqual({ kind: 'session', action: 'new' });
    expect(parseSlashCommand('/s new 修登录')).toEqual({ kind: 'session', action: 'new', title: '修登录' });
    expect(parseSlashCommand('/s status')).toEqual({ kind: 'session', action: 'status' });
    expect(parseSlashCommand('/s pin 3')).toEqual({ kind: 'dropped', command: 'session pin' });
  });

  test('workspace：list / status / switch / add', () => {
    expect(parseSlashCommand('/ws')).toEqual({ kind: 'workspace', action: 'status' });
    expect(parseSlashCommand('/workspace list all')).toEqual({ kind: 'workspace', action: 'list', limit: 'all' });
    expect(parseSlashCommand('/ws switch 2')).toEqual({ kind: 'workspace', action: 'switch', target: '2' });
    expect(parseSlashCommand('/ws switch D:\\projects\\my-app')).toEqual({
      kind: 'workspace',
      action: 'switch',
      target: 'D:\\projects\\my-app',
    });
    expect(parseSlashCommand('/ws add D:\\projects\\new-app')).toEqual({
      kind: 'workspace',
      action: 'add',
      path: 'D:\\projects\\new-app',
    });
    expect(parseSlashCommand('/ws switch')).toBeNull();
  });

  test('history', () => {
    expect(parseSlashCommand('/history')).toEqual({ kind: 'history', action: 'list', limit: 5 });
    expect(parseSlashCommand('/history list 10')).toEqual({ kind: 'history', action: 'list', limit: 10 });
    expect(parseSlashCommand('/history list all')).toEqual({ kind: 'history', action: 'list', limit: 'all' });
    expect(parseSlashCommand('/history show 3')).toEqual({ kind: 'history', action: 'show', index: 3 });
    expect(parseSlashCommand('/history show x')).toBeNull();
  });

  test('at', () => {
    expect(parseSlashCommand('/at')).toEqual({ kind: 'at', action: 'status' });
    expect(parseSlashCommand('/at f "D:\\my docs\\spec.md"')).toEqual({
      kind: 'at',
      action: 'file',
      path: 'D:\\my docs\\spec.md',
    });
    expect(parseSlashCommand('/at s 部署')).toEqual({ kind: 'at', action: 'session' });
    expect(parseSlashCommand('/at rm 1')).toEqual({ kind: 'at', action: 'remove', index: 1 });
    expect(parseSlashCommand('/at clear')).toEqual({ kind: 'at', action: 'clear' });
  });

  test('开关类命令', () => {
    expect(parseSlashCommand('/merge on')).toEqual({ kind: 'merge', mode: 'on' });
    expect(parseSlashCommand('/mg')).toEqual({ kind: 'merge', mode: 'status' });
    expect(parseSlashCommand('/media at')).toEqual({ kind: 'media', action: 'ref', style: 'at' });
    expect(parseSlashCommand('/md off')).toEqual({ kind: 'media', action: 'merge', mode: 'off' });
    expect(parseSlashCommand('/media status')).toEqual({ kind: 'media', action: 'status' });
    expect(parseSlashCommand('/notify on')).toEqual({ kind: 'notify', mode: 'on' });
    expect(parseSlashCommand('/watch')).toEqual({ kind: 'notify', mode: 'status' });
    expect(parseSlashCommand('/notify tasks on')).toEqual({ kind: 'notify', mode: 'tasks' });
    expect(parseSlashCommand('/surface on')).toEqual({ kind: 'surface', mode: 'on' });
    expect(parseSlashCommand('/wxprompt')).toEqual({ kind: 'surface', mode: 'status' });
    expect(parseSlashCommand('/raw once')).toEqual({ kind: 'raw', mode: 'once' });
    expect(parseSlashCommand('/raw')).toEqual({ kind: 'raw', mode: 'status' });
  });

  test('卡片命令与 P<n>= 前缀', () => {
    expect(parseSlashCommand('/rq')).toEqual({ kind: 'card', action: 'close-question' });
    expect(parseSlashCommand('/rp')).toEqual({ kind: 'card', action: 'reject-permission' });
    expect(parseSlashCommand('P1=/rq')).toEqual({ kind: 'card', action: 'close-question', index: 1 });
    expect(parseSlashCommand('p2=/rp')).toEqual({ kind: 'card', action: 'reject-permission', index: 2 });
  });

  test('不认识的命令返回 null（交给 agent）', () => {
    expect(parseSlashCommand('/compact')).toBeNull();
    expect(parseSlashCommand('/plan')).toBeNull();
    expect(parseSlashCommand('普通文本')).toBeNull();
  });

  test('上游有、OpenChamber 没有对应能力的命令被认出并说明', () => {
    for (const name of ['fork', 'preset', 'model', 'reasoning', 'perm', 'enter', 'steps', 'skill', 'flush']) {
      expect(parseSlashCommand(`/${name}`)).toEqual({ kind: 'dropped', command: name });
      expect(parseSlashCommand(`/${name} list`)).toEqual({ kind: 'dropped', command: name });
    }
    expect(parseSlashCommand('/p list')).toEqual({ kind: 'dropped', command: 'preset' });
    expect(parseSlashCommand('/f')).toEqual({ kind: 'dropped', command: 'flush' });
    expect(parseSlashCommand('/s pin 3')).toEqual({ kind: 'dropped', command: 'session pin' });
    expect(parseSlashCommand('/s unpin')).toEqual({ kind: 'dropped', command: 'session unpin' });
  });
});

describe('合并后缀', () => {
  test('.. 追加、!! 提交、其余自动', () => {
    expect(splitMergeSuffix('帮我改下 ..')).toEqual({ text: '帮我改下', mode: 'append' });
    expect(splitMergeSuffix('跑一下测试 !!')).toEqual({ text: '跑一下测试', mode: 'submit' });
    expect(splitMergeSuffix('就这样')).toEqual({ text: '就这样', mode: 'auto' });
    expect(splitMergeSuffix('省略号……')).toEqual({ text: '省略号……', mode: 'auto' });
  });
});
