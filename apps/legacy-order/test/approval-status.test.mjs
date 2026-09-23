import assert from 'node:assert/strict';
import test from 'node:test';
import { isApprovedStatus, waitForApprovedStatus } from '../lib/approval.mjs';

test('recognizes supported approved status labels', () => {
  assert.equal(isApprovedStatus('PP2026092319423938054 审核通过'), true);
  assert.equal(isApprovedStatus('状态：已审核'), true);
  assert.equal(isApprovedStatus('审核成功'), true);
  assert.equal(isApprovedStatus('待审核'), false);
});

test('refreshes until the purchase plan becomes approved', async () => {
  const rows = ['PP1 待审核', 'PP1 审核中', 'PP1 审核通过'];
  let index = 0;
  const result = await waitForApprovedStatus({
    readRow: async () => rows[index],
    refresh: async () => { index = Math.min(index + 1, rows.length - 1); },
    wait: async () => {},
    timeoutMs: 1000,
    intervalMs: 0,
  });
  assert.equal(result, 'PP1 审核通过');
  assert.equal(index, 2);
});

test('reports the last observed status when approval times out', async () => {
  await assert.rejects(
    waitForApprovedStatus({
      readRow: async () => 'PP1 仍在审核中',
      refresh: async () => {},
      wait: async () => new Promise((resolve) => setTimeout(resolve, 2)),
      timeoutMs: 1,
      intervalMs: 0,
    }),
    /PP1 仍在审核中/,
  );
});
