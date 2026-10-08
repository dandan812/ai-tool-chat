import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { once } from 'node:events';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';

const mediaTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.json': 'application/json', '.webp': 'image/webp',
};

async function serveStatic(request, response, directory, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  const root = await realpath(directory);
  let name;
  try { name = decodeURIComponent(pathname); }
  catch { response.writeHead(400).end(); return; }
  if (name.includes('\0') || name.includes('\\')) { response.writeHead(400).end(); return; }
  let file = resolve(root, '.' + name);
  const outside = candidate => {
    const diff = relative(root, candidate);
    return diff === '..' || diff.startsWith('..' + sep) || resolve(root, diff) !== candidate;
  };
  if (outside(file)) { response.writeHead(400).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
  } catch {
    if (extname(name)) { response.writeHead(404).end(); return; }
    file = resolve(root, 'index.html');
    name = '/index.html';
  }
  if (outside(await realpath(file))) { response.writeHead(404).end(); return; }
  const bytes = await readFile(file);
  response.writeHead(200, {
    'Content-Type': mediaTypes[extname(file)] || 'application/octet-stream',
    'Cache-Control': name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

export function createHTTPServer(runtime, { publicOrigin, development = false, staticDirectory }) {
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || (!development && origin.protocol !== 'https:')) {
    throw new Error('A canonical HTTPS PUBLIC_ORIGIN is required');
  }
  let active = 0;
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (incoming, outgoing) => {
    if (active >= 16) {
      outgoing.writeHead(503, { 'Connection': 'close', 'Retry-After': '2' }).end();
      return;
    }
    active++;
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.writeHead(400).end();
        return;
      }
      let path = incoming.url;
      if (path === '/healthz') {
        if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405).end(); return; }
        outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        outgoing.end(incoming.method === 'HEAD' ? undefined : '{"status":"ok","runtime":"node","storage":"sqlite-files"}');
        return;
      }
      const isAPI = path === '/api' || path.startsWith('/api/') || path.startsWith('/api?');
      if (staticDirectory && !isAPI) {
        await serveStatic(incoming, outgoing, staticDirectory, new URL(publicOrigin + path).pathname);
        return;
      }
      if (isAPI) {
        path = path.slice(4) || '/';
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined && !['host', 'connection', 'transfer-encoding', 'cf-connecting-ip'].includes(name)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
      }
      const ip = incoming.headers['x-real-ip'];
      const trustedProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(incoming.socket.remoteAddress);
      const address = trustedProxy && typeof ip === 'string' && isIP(ip) ? ip : incoming.socket.remoteAddress;
      headers.set('CF-Connecting-IP', address || 'unknown');
      headers.delete('x-real-ip');
      headers.delete('x-forwarded-for');
      const controller = new AbortController();
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) controller.abort();
      });
      let body;
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        const limit = headers.get('content-type')?.includes('multipart/form-data')
          ? 6 * 1024 * 1024 : 2 * 1024 * 1024;
        const rejectBody = () => {
          outgoing.writeHead(413, { 'Connection': 'close', 'Content-Type': 'application/json' });
          outgoing.end('{"error":{"code":"BODY_TOO_LARGE","message":"Request body too large"}}');
        };
        if (Number(headers.get('content-length')) > limit) { rejectBody(); return; }
        const chunks = [];
        let size = 0;
        // Do not destroy the incoming socket before the 413 response can be sent.
        const iterator = incoming.iterator({ destroyOnReturn: false });
        for await (const chunk of iterator) {
          size += chunk.length;
          if (size > limit) { rejectBody(); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks, size);
      }
      const request = new Request(publicOrigin + path, {
        method: incoming.method, headers, body, duplex: 'half', signal: controller.signal,
      });
      const response = await runtime.fetch(request);
      const responseHeaders = {};
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') responseHeaders[name] = value;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      outgoing.writeHead(response.status, responseHeaders);
      if (!response.body || incoming.method === 'HEAD') { outgoing.end(); return; }
      const reader = response.body.getReader();
      try {
        while (!outgoing.destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!outgoing.write(value)) await once(outgoing, 'drain', { signal: controller.signal });
        }
        if (outgoing.destroyed) await reader.cancel();
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally { reader.releaseLock(); }
      outgoing.end();
    } catch {
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        outgoing.end('{"error":{"code":"SERVER_UNAVAILABLE","message":"Service temporarily unavailable"}}');
      } else outgoing.destroy();
      console.error('HTTP request failed');
    } finally { active--; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 128;
  return server;
}
