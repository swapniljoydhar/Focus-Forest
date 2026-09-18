import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { startPreview } from './scripts/preview-trees.mjs';

async function withPreview(options, check) {
  const server = startPreview(options);
  try {
    if (!server.listening) await once(server, 'listening');
    await check(server);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

test('preview defaults to loopback and serves sample artwork', async () => {
  const previousHost = process.env.HOST;
  delete process.env.HOST;
  try {
    await withPreview({ port: 0 }, async (server) => {
      assert.equal(server.address().address, '127.0.0.1');
      const base = `http://127.0.0.1:${server.address().port}`;
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /SAMPLE DATA/);
      assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
      const renderer = await fetch(`${base}/dashboard/tree-renderer.js`);
      assert.equal(renderer.status, 200);
      assert.match(await renderer.text(), /renderGardenTree/);
      const transitive = await fetch(`${base}/shared/constants.js`);
      assert.equal(transitive.status, 200);
      assert.match(await transitive.text(), /GOLDEN_ANGLE/);
      assert.equal((await fetch(`${base}/shared/missing.js`)).status, 404);
      assert.equal((await fetch(`${base}/missing.txt`)).status, 404);
    });
  } finally {
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
  }
});

test('preview honors an explicit loopback host override', async () => {
  const previousHost = process.env.HOST;
  process.env.HOST = '127.0.0.2';
  try {
    await withPreview({ port: 0 }, async (server) => {
      assert.equal(server.address().address, '127.0.0.2');
    });
  } finally {
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
  }
});
