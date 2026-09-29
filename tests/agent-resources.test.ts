import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildAgentResources, skillZip } from '../scripts/agent-resources.mjs';
import { createPetServer } from '../scripts/pet-site.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test('published skill files and reproducible ZIP match discovery hashes and verified deployments', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'rarepet-agent-package-'));
  try {
    const first = await buildAgentResources(project, out);
    const zip = await readFile(path.join(out, 'skills/rarepet.zip'));
    assert.equal(hash(zip), first.skill.sha256);
    assert.equal(first.chain.id, 4663);
    assert.equal(first.appBuild.careConfigured, false);
    assert.equal(first.appBuild.launchConfigured, false);
    const second = await buildAgentResources(project, out, { careAddress: first.deployments.care.address, launchAddress: first.deployments.launch.address });
    assert.equal(second.appBuild.careConfigured, true);
    assert.equal(second.appBuild.launchConfigured, true);
    assert.equal(second.skill.sha256, first.skill.sha256);
    assert.ok(first.skill.files.some(file => file.path === 'rarepet/SKILL.md'));
    assert.ok(first.skill.files.some(file => file.path === 'rarepet/scripts/rarepet.mjs'));
    const archived = new Map<string, Buffer>();
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      assert.equal(zip.readUInt16LE(offset + 8), 0);
      const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26);
      const start = offset + 30 + length;
      archived.set(zip.subarray(offset + 30, start).toString(), zip.subarray(start, start + size));
      offset = start + size;
    }
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    assert.equal(archived.size, first.skill.files.length);
    for (const file of first.skill.files) {
      const bytes = await readFile(path.join(out, 'skills', file.path));
      assert.equal(bytes.length, file.bytes);
      assert.equal(hash(bytes), file.sha256);
      assert.deepEqual(archived.get(file.path), bytes);
    }
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('agent routes serve the packaged files with correct types and restrict unrelated paths', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'rarepet-agent-routes-'));
  const server = createPetServer(out);
  try {
    const manifest = await buildAgentResources(project, out);
    await writeFile(path.join(out, 'agent/index.html'), '<h1>Agent setup</h1>');
    await writeFile(path.join(out, '.env'), 'this must not be served');
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const route of ['/agent', '/agent/', '/agent/index.html']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/html/);
    }
    for (const file of manifest.skill.files) {
      const response = await fetch(origin + new URL(file.url).pathname);
      assert.equal(response.status, 200, file.path);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256);
    }
    const markdown = await fetch(origin + '/skills/rarepet/SKILL.md');
    assert.match(markdown.headers.get('content-type')!, /text\/markdown/);
    const archive = await fetch(origin + '/skills/rarepet.zip');
    assert.equal(archive.headers.get('content-type'), 'application/zip');
    assert.match(archive.headers.get('content-disposition')!, /attachment; filename="rarepet.zip"/);
    const discovery = await fetch(origin + '/agent/manifest.json');
    assert.equal((await discovery.json()).skill.sha256, manifest.skill.sha256);
    const llms = await fetch(origin + '/llms.txt');
    assert.equal(llms.status, 200);
    for (const route of ['/.env', '/skills/rarepet/.env', '/skills/rarepet/../../.env', '/scripts/agent-resources.mjs']) {
      assert.equal((await fetch(origin + route)).status, 404);
    }
    assert.equal((await fetch(origin + '/agent/manifest.json', { method: 'POST' })).status, 405);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(out, { recursive: true, force: true });
  }
});

test('skill packaging refuses hidden files, symlinks and mismatched contract identities', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'rarepet-agent-boundary-'));
  try {
    for (const directory of ['skills/rarepet', 'contracts/rare-pet/deployments', 'contracts/rare-launchpad/deployments']) {
      await mkdir(path.dirname(path.join(fixture, directory)), { recursive: true });
      await cp(path.join(project, directory), path.join(fixture, directory), { recursive: true });
    }
    const out = path.join(fixture, 'out');
    const hidden = path.join(fixture, 'skills/rarepet/.env');
    await writeFile(hidden, 'SECRET=never-publish');
    await assert.rejects(buildAgentResources(fixture, out), /Unsupported skill resource/);
    await rm(hidden);
    const link = path.join(fixture, 'skills/rarepet/references/link.md');
    await symlink(path.join(project, 'README.md'), link);
    await assert.rejects(buildAgentResources(fixture, out), /Unsupported skill resource/);
    await rm(link);
    const protocolPath = path.join(fixture, 'skills/rarepet/references/protocol.json');
    const protocol = JSON.parse(await readFile(protocolPath, 'utf8'));
    protocol.care = '0x1111111111111111111111111111111111111111';
    await writeFile(protocolPath, JSON.stringify(protocol));
    await assert.rejects(buildAgentResources(fixture, out), /does not match/);
    assert.throws(() => skillZip([{ name: 'rarepet/../unsafe.md', bytes: Buffer.from('bad') }]), /Invalid skill/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
