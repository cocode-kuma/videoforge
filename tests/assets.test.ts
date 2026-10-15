import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataStore } from '../plugins/cocode-data-store/index.js';
import { AssetService, classifyAsset } from '../plugins/cocode-data-store/assets.js';
import { readConfig } from '../shared/config.js';
import { isPublicAddress, safeFetch } from '../shared/remote.js';

test('asset records retain content hash and ownership; invalid files do not persist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vf-assets-'));
  const store = new DataStore(readConfig(root));
  try {
    await store.init();
    const owner = await store.register('asset-owner@example.com', 'test-password-123', 'Owner', 'kuma', '192.0.2.1');
    const stranger = await store.register('asset-stranger@example.com', 'test-password-123', 'Stranger', 'kuma', '192.0.2.2');
    const p = await store.createProject(owner.id, 'Assets');
    const service = new AssetService(store);
    const asset = await service.upload(owner.id, p.id, 'scene.tsx', Readable.from(['export const Scene = () => null;']));
    assert.equal(asset.kind, 'source'); assert.equal(asset.sha256.length, 64);
    await assert.rejects(service.upload(stranger.id, p.id, 'scene.tsx', Readable.from(['hello'])));
    await assert.rejects(service.upload(owner.id, p.id, '../evil.ts', Readable.from(['hello'])));
    await assert.rejects(service.upload(owner.id, p.id, 'fake.png', Readable.from(['not an image'])));
    assert.equal((await store.loadProject(owner.id, p.id)).assets?.length, 1);
    await service.remove(owner.id, p.id, asset.id);
    assert.equal((await store.loadProject(owner.id, p.id)).assets?.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('source import blocks local addresses before connecting', async () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.2','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','2002:7f00:1::']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(safeFetch('http://127.0.0.1/'), /内网/);
  await assert.rejects(safeFetch('file:///etc/passwd'), /HTTP/);
  assert.throws(() => classifyAsset(Buffer.from('bad'), 'fake.mp4'));
});
