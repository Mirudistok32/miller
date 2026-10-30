#!/usr/bin/env node
/**
 * Автоформат файла после правки агентом. Один скрипт для двух хостов:
 *   - Claude Code, PostToolUse (Edit|Write|MultiEdit): путь в `tool_input.file_path`;
 *   - Cursor, afterFileEdit: путь в `file_path`.
 * Запускает только то, что есть в node_modules/.bin проекта: stylelint --fix для CSS,
 * prettier --write, eslint --fix для TS/Vue (кроме тестов). Никогда не блокирует агента:
 * любая ошибка — тихий выход с кодом 0.
 *
 * Копия живёт в проекте: `.claude/hooks/format.mjs` (подключение — docs/quality.md).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

async function main() {
  let payload = '';
  for await (const chunk of process.stdin) payload += chunk;

  let data = {};
  try {
    data = JSON.parse(payload || '{}');
  } catch {
    return;
  }
  const root = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const raw = data.tool_input?.file_path || data.file_path || data.filePath || data.path || '';
  if (!raw) return;
  const file = isAbsolute(raw) ? raw : join(root, raw);
  const inside = relative(root, file);
  // Вне проекта, зависимости, сборка и сами хуки (правка хука в Cursor переоткрывает вкладку).
  if (inside.startsWith('..') || /(^|[/\\])(node_modules|dist|out|\.next)[/\\]/.test(inside))
    return;
  if (/[/\\]\.(cursor|claude)[/\\]hooks[/\\]/.test(file)) return;

  const run = (name, args) => {
    const bin = join(root, 'node_modules', '.bin', name);
    if (existsSync(bin)) spawnSync(bin, [...args, file], { stdio: 'ignore', cwd: root });
  };

  if (/\.(css|scss|vue)$/.test(file)) run('stylelint', ['--fix', '--allow-empty-input']);
  if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|json|css|scss|md|html)$/.test(file)) {
    run('prettier', ['--write', '--ignore-unknown']);
  }
  if (/\.(ts|tsx|vue)$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file)) run('eslint', ['--fix']);
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
