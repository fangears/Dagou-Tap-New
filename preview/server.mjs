'use strict';
/* 本地预览服务器：node preview/server.mjs [port] */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 8642);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mjs': 'text/javascript; charset=utf-8',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const urlPath = decodeURIComponent(url.pathname);

  // 保存端点：POST /__save?path=xxx（仅允许写入 assets/ 目录，供构建工具用）
  if (req.method === 'POST' && urlPath === '/__save') {
    const target = url.searchParams.get('path') ?? '';
    const resolved = path.join(root, target);
    if (!resolved.startsWith(path.join(root, 'assets'))) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, Buffer.concat(chunks));
      res.writeHead(200);
      res.end('saved ' + target);
    });
    return;
  }

  let filePath = path.join(root, urlPath === '/' ? 'preview/index.html' : urlPath.slice(1));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('not found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`预览服务器: http://127.0.0.1:${port}/preview/index.html`);
});
