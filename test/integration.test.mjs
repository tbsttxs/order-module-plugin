import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import test from 'node:test';

const listen = (port, handler) => new Promise((resolve, reject) => {
  const server = http.createServer(handler);
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server));
});

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`workbench exited with ${child.exitCode}`);
    try {
      const response = await fetch('http://127.0.0.1:8791/health');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('workbench did not become healthy');
}

test('serves the workbench and proxies result downloads', async (t) => {
  const legacy = await listen(8787, (req, res) => {
    if (req.url === '/api/status') return void res.end('{}');
    if (req.url === '/api/download/run-1') {
      res.writeHead(200, {'content-type':'application/octet-stream','content-disposition':'attachment; filename="result.xlsx"'});
      return void res.end('legacy-result');
    }
    res.writeHead(404).end();
  });
  const fresh = await listen(8790, (req, res) => {
    if (req.url === '/health') return void res.end('{}');
    if (req.url === '/api/download/run-2') {
      res.writeHead(200, {'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="result.csv"'});
      return void res.end('fresh-result');
    }
    res.writeHead(404).end();
  });
  const child = spawn(process.execPath, ['server.mjs'], {cwd:process.cwd(), windowsHide:true, stdio:'ignore'});
  t.after(async () => {
    child.kill();
    legacy.close(); fresh.close();
    await Promise.allSettled([once(legacy, 'close'), once(fresh, 'close')]);
  });
  await waitForHealth(child);

  const page = await fetch('http://127.0.0.1:8791/').then((response) => response.text());
  assert.match(page, /采购自动化工作台/);
  assert.match(page, /classList\.toggle\('disabled-link'/);
  assert.match(page, /id="togglePassword"[^>]+aria-label="显示密码"/);
  assert.match(page, /password\.type=show\?'text':'password'/);
  assert.match(page, /input\[name=freshMode\]/);
  assert.match(page, /确认并开始正式新品下单/);

  const legacyDownload = await fetch('http://127.0.0.1:8791/api/download/legacy/run-1');
  assert.equal(legacyDownload.status, 200);
  assert.equal(await legacyDownload.text(), 'legacy-result');
  assert.match(legacyDownload.headers.get('content-disposition'), /result\.xlsx/);

  const freshDownload = await fetch('http://127.0.0.1:8791/api/download/fresh/run-2');
  assert.equal(freshDownload.status, 200);
  assert.equal(await freshDownload.text(), 'fresh-result');
});
