import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

test('emitted image and RPC functions boot with JavaScript-only dependencies and return JSON validation errors', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const directory = await mkdtemp(join(tmpdir(), 'rarepet-api-runtime-'));
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  const previousRpc = process.env.RAREPET_RPC_URL;
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    // Vercel transpiles each source file separately. Bundling this test would
    // hide broken relative imports that only fail in the deployed function.
    for (const filename of ['api/launch-image.ts', 'api/rpc.ts', 'games/rare-pet/launch-upload-message.ts', 'server/rarepet-rpc.ts']) {
      const source = await readFile(join(root, filename), 'utf8');
      const emitted = ts.transpileModule(source, { fileName: filename, compilerOptions: { ...options, noEmit: false, sourceMap: false } });
      const destination = join(directory, filename.replace(/\.ts$/, '.js'));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, emitted.outputText);
    }
    const { default: handler } = await import(pathToFileURL(join(directory, 'api/launch-image.js')).href);
    const request = new IncomingMessage(new Socket());
    request.method = 'GET';
    const methodResponse = new ServerResponse(request);
    await handler(request, methodResponse);
    assert.equal(methodResponse.statusCode, 405);
    assert.equal(methodResponse.getHeader('Content-Type'), 'application/json');
    assert.equal(methodResponse.writableEnded, true);

    const { default: rpcHandler } = await import(pathToFileURL(join(directory, 'api/rpc.js')).href);
    const rpcResponse = new ServerResponse(request);
    let rpcBody = '';
    const end = rpcResponse.end.bind(rpcResponse);
    rpcResponse.end = ((chunk: string) => { rpcBody = chunk; return end(chunk); }) as typeof rpcResponse.end;
    await rpcHandler(request, rpcResponse);
    assert.equal(rpcResponse.statusCode, 405);
    assert.equal(rpcResponse.getHeader('Content-Type'), 'application/json');
    assert.equal(rpcResponse.getHeader('Allow'), 'POST');
    assert.equal(rpcResponse.writableEnded, true);
    assert.deepEqual(JSON.parse(rpcBody), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Use POST.' } });

    process.env.BLOB_READ_WRITE_TOKEN = 'test-placeholder-never-used';
    process.env.RAREPET_RPC_URL = 'https://rpc.invalid/test-placeholder-never-used';
    request.method = 'POST';
    request.headers = { origin: 'https://rarepet.app', 'content-type': 'application/json' };
    const invalidResponse = new ServerResponse(request);
    // Validation fails before any RPC or storage access. A real Node response
    // rejects writeHead(400) if writeHead(200) ran before awaiting validation.
    await handler(Object.assign(request, { body: {} }), invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(invalidResponse.getHeader('Content-Type'), 'application/json');
    assert.equal(invalidResponse.writableEnded, true);
    request.destroy();
  } finally {
    if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    if (previousRpc === undefined) delete process.env.RAREPET_RPC_URL;
    else process.env.RAREPET_RPC_URL = previousRpc;
    await rm(directory, { recursive: true, force: true });
  }
});
