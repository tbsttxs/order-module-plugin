import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { beijingNow, readJson, resultFileName, writeJson } from '../lib/state.mjs';

test('formats result names with Beijing time', () => {
  const date = new Date('2026-09-21T03:38:12.000Z');
  assert.equal(beijingNow(date), '2026-09-21 11:38:12');
  assert.equal(resultFileName('老品下单', date), '老品下单-20260921-1138.xlsx');
});

test('persists progress and terminal state for the status callback chain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-workbench-'));
  const progressFile = path.join(dir, 'progress.json');
  const stateFile = path.join(dir, 'state.json');
  const result = path.join(dir, '老品下单-20260921-1138.xlsx');
  fs.writeFileSync(result, 'test result');

  writeJson(progressFile, { step: '正在提交采购计划', row: 2, sku: 'SKU-1' });
  assert.equal(readJson(progressFile).step, '正在提交采购计划');

  const terminal = {
    id: 'run-1', status: '完成', result,
    progress: { step: '全部完成', output: result },
    endedAt: '2026-09-21 11:38:12'
  };
  writeJson(stateFile, { history: [terminal] });
  const restored = readJson(stateFile).history[0];
  assert.equal(restored.status, '完成');
  assert.equal(restored.progress.step, '全部完成');
  assert.equal(fs.existsSync(restored.result), true);
});
