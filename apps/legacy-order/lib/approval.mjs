export function isApprovedStatus(text) {
  return /审核通过|已审核|审核成功/.test(String(text || ''));
}

export async function waitForApprovedStatus({ readRow, refresh, wait, timeoutMs = 20000, intervalMs = 1200 }) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  do {
    last = String(await readRow() || '').replace(/\s+/g, ' ').trim();
    if (isApprovedStatus(last)) return last;
    await refresh();
    await wait(intervalMs);
  } while (Date.now() < deadline);
  throw new Error(`最终状态未回读到审核通过：${last || '未找到当前采购计划'}`);
}
