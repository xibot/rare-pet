import { context } from 'esbuild';
import { mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
export async function buildPetSite({ outdir = path.join(project, 'dist-pet'), watch = false } = {}) {
  const address = process.env.RAREPET_CONTRACT_ADDRESS || '';
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('RAREPET_CONTRACT_ADDRESS must be an EVM address.');
  const launchpad = process.env.RAREPET_LAUNCHPAD_ADDRESS || '';
  if (launchpad && !/^0x[0-9a-fA-F]{40}$/.test(launchpad)) throw new Error('RAREPET_LAUNCHPAD_ADDRESS must be an EVM address.');
  await mkdir(outdir, { recursive: true });
  const build = await context({ absWorkingDir: project, entryPoints: { index: 'games/rare-pet/index.tsx', 'share-gif-worker': 'games/rare-pet/share-gif-worker.ts' }, outdir, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', minify: true, loader: { '.woff2': 'file' }, assetNames: 'assets/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"', __RAREPET_CONTRACT__: JSON.stringify(address), __RAREPET_LAUNCHPAD__: JSON.stringify(launchpad), __RAREPET_LAUNCH_STORAGE__: JSON.stringify(Boolean(process.env.BLOB_READ_WRITE_TOKEN)) }, logLevel: 'warning', plugins: [{ name: 'pet-static', setup(build) { build.onEnd(async result => {
    if (result.errors.length) return;
    await writeFile(path.join(outdir, 'index.html'), await readFile(path.join(project, 'games/rare-pet/index.html')));
    await mkdir(path.join(outdir, 'docs'), { recursive: true });
    await mkdir(path.join(outdir, 'launch'), { recursive: true });
    await writeFile(path.join(outdir, 'launch/index.html'), await readFile(path.join(project, 'games/rare-pet/index.html')));
    await writeFile(path.join(outdir, 'docs/index.html'), await readFile(path.join(project, 'games/rare-pet/docs.html')));
    await writeFile(path.join(outdir, 'favicon.svg'), await readFile(path.join(project, 'games/rare-rush/assets/favicon.svg')));
    const notices = await Promise.all(['THIRD_PARTY_NOTICES.md', 'licenses/friendsdk-APACHE-2.0.txt', 'licenses/doppler-sdk-MIT.txt', 'node_modules/gifenc/LICENSE.md', 'node_modules/@rarefriends/friendsdk/NOTICE.md', 'games/rare-rush/assets/fonts/SILKSCREEN-OFL.txt', 'games/rare-rush/assets/fonts/ARCHIVO-OFL.txt', 'games/rare-rush/assets/fonts/SOMETYPE-MONO-OFL.txt'].map(file => readFile(path.join(project, file), 'utf8')));
    await writeFile(path.join(outdir, 'credits.txt'), notices.join('\n\n'));
  }); } }] });
  await build.rebuild(); if (watch) await build.watch(); else await build.dispose();
  return { outdir, close: () => build.dispose() };
}
export function createPetServer(outdir) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/launch-quotes' || url.pathname === '/api/launch-image') {
        const endpoint = url.pathname === '/api/launch-quotes' ? '../api/launch-quotes.ts' : '../api/launch-image.ts';
        const handler = (await import(endpoint)).default;
        await handler(req, res); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      const pathname = url.pathname === '/' ? '/index.html' : /^\/docs\/?$/.test(url.pathname) ? '/docs/index.html' : /^\/launch\/?$/.test(url.pathname) ? '/launch/index.html' : url.pathname;
      if (!/^\/(?:index\.(?:html|js|css)|share-gif-worker\.js|(?:docs|launch)\/index\.html|favicon.svg|credits.txt|assets\/[\w-]+\.woff2)$/.test(pathname)) { res.writeHead(404).end(); return; }
      const root = await realpath(outdir), file = await realpath(path.join(root, pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'dev'; if (!['dev', 'build'].includes(mode)) throw new Error('Usage: node scripts/pet-site.mjs dev|build');
  const built = await buildPetSite({ watch: mode === 'dev' });
  if (mode === 'dev') {
    const server = createPetServer(built.outdir); server.listen(4175, '127.0.0.1', () => console.log('RarePet: http://localhost:4175'));
    const stop = () => { server.close(); void built.close().finally(() => process.exit()); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); server.on('error', error => { console.error(error.message); stop(); });
  } else console.log(`Built RarePet in ${built.outdir}`);
}
