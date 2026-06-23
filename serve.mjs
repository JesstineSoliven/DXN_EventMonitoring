import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4500;

let OPENAI_API_KEY = '';
try {
  OPENAI_API_KEY = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8')).OPENAI_API_KEY || '';
} catch (_) { /* config.json not present locally yet */ }

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Local stand-ins for the Vercel serverless functions in /api — keeps the
// OPENAI_API_KEY server-side only, mirroring production behavior.
async function handleEmbeddings(req, res) {
  const { input } = JSON.parse(await readBody(req) || '{}');
  if (!input) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing "input"' })); return; }
  const apiRes = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input }),
  });
  const data = await apiRes.text();
  res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
  res.end(data);
}

async function handleChat(req, res) {
  const { messages, model, max_tokens, temperature } = JSON.parse(await readBody(req) || '{}');
  if (!Array.isArray(messages)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing "messages"' })); return; }
  const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini', stream: true,
      max_tokens: max_tokens || 600, temperature: temperature ?? 0.7,
      messages,
    }),
  });
  if (!apiRes.ok || !apiRes.body) {
    res.writeHead(apiRes.status);
    res.end(await apiRes.text());
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const reader = apiRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/embeddings') return handleEmbeddings(req, res);
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);

  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
