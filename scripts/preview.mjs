import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const types = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'curriculum.js': 'text/javascript; charset=utf-8',
  'catalog.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'videos.json': 'application/json; charset=utf-8',
  'revision.txt': 'text/plain; charset=utf-8',
};
const port = Number(process.env.LESSON_PREVIEW_PORT || 4173);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (!Object.hasOwn(types, name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL('../dist/' + name, import.meta.url));
    response.writeHead(200, { 'Content-Type': types[name] }).end(body);
  } catch {
    response.writeHead(503).end('Run npm run build before preview.');
  }
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
