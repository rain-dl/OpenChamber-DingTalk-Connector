import { describe, expect, test } from 'bun:test';

import { findHelpEntry, formatHelp, helpEntries, helpTopic, shortestSpelling } from '../service/catalog.js';

describe('帮助目录', () => {
  test('每条命令都有摘要、用法和例子', () => {
    for (const entry of helpEntries()) {
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.usage).toContain(entry.command);
      expect(entry.examples.length).toBeGreaterThan(0);
    }
  });

  test('命令与别名唯一', () => {
    const names = helpEntries().flatMap((entry) => [entry.command, ...entry.aliases]);
    expect(new Set(names).size).toBe(names.length);
  });

  test('短拼写规则与上游一致', () => {
    const byCommand = (command: string) => helpEntries().find((entry) => entry.command === command)!;
    expect(shortestSpelling(byCommand('/session'))).toBe('/s');
    expect(shortestSpelling(byCommand('/workspace'))).toBe('/ws');
    expect(shortestSpelling(byCommand('/merge'))).toBe('/mg');
    expect(shortestSpelling(byCommand('/media'))).toBe('/md');
    expect(shortestSpelling(byCommand('/history'))).toBe('/history');
  });

  test('按别名也能查到条目', () => {
    expect(findHelpEntry('s')?.command).toBe('/session');
    expect(findHelpEntry('/ws')?.command).toBe('/workspace');
    expect(findHelpEntry('SESSION')?.command).toBe('/session');
    expect(findHelpEntry('nope')).toBeUndefined();
  });

  test('一览列出所有命令，并说明哪些没有对应能力', () => {
    const help = formatHelp();
    for (const entry of helpEntries()) {
      expect(help).toContain(shortestSpelling(entry));
    }
    expect(help).toContain('/fork');
    expect(help).toContain('没有对应能力');
  });

  test('单条详情带用法与全部例子', () => {
    const entry = findHelpEntry('session')!;
    const topic = helpTopic(entry);
    expect(topic).toContain('/s list current');
    expect(topic).toContain('用法：/session list');
    for (const example of entry.examples) expect(topic).toContain(example.line);
  });
});
