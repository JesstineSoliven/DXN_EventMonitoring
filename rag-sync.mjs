/**
 * rag-sync.mjs
 * Run: node rag-sync.mjs
 *
 * Lists files from the Google Drive folder, downloads them,
 * extracts text, creates OpenAI embeddings, and saves knowledge-base.json.
 *
 * Re-run whenever you add or update files in the Drive folder.
 * Supported: .pptx  .docx  Google Docs  Google Slides  .txt  .md
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';
import { parseOffice }   from 'officeparser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG — keys are read from config.json (gitignored) ──────────────────────
import { createRequire } from 'module';
const require    = createRequire(import.meta.url);
const _cfg       = require('./config.json');
const GOOGLE_API_KEY = _cfg.GOOGLE_API_KEY;
const OPENAI_API_KEY = _cfg.OPENAI_API_KEY;
const FOLDER_ID      = '16Fyi0mI03hVAh-USG9C2oaAymM626jQZ';
const OUTPUT_FILE    = path.join(__dirname, 'knowledge-base.json');
const CHUNK_WORDS    = 350;

// ── LIST FILES ────────────────────────────────────────────────────────────────
async function listFiles(folderId) {
  const url = `https://www.googleapis.com/drive/v3/files`
    + `?q='${folderId}'+in+parents+and+trashed=false`
    + `&key=${GOOGLE_API_KEY}`
    + `&fields=files(id,name,mimeType)`
    + `&pageSize=100`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${JSON.stringify(data.error?.message)}`);
  return data.files || [];
}

// ── DOWNLOAD & EXTRACT TEXT ───────────────────────────────────────────────────
async function extractText(file) {
  const { id, name, mimeType } = file;
  let url, isBinary = false, ext = '';

  if (mimeType === 'application/vnd.google-apps.document') {
    url = `https://docs.google.com/document/d/${id}/export?format=txt`;
  } else if (mimeType === 'application/vnd.google-apps.presentation') {
    url = `https://docs.google.com/presentation/d/${id}/export/txt`;
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}`;
    isBinary = true; ext = '.pptx';
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}`;
    isBinary = true; ext = '.docx';
  } else if (mimeType.startsWith('text/') || /\.(txt|md)$/i.test(name)) {
    url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}`;
  } else {
    return null; // unsupported (PDF, image, etc.)
  }

  const res = await fetch(url);
  if (!res.ok) { console.log(`   ⚠  Download failed (${res.status})`); return null; }

  if (isBinary) {
    // Save to temp file, parse with officeparser, then delete
    const buf      = Buffer.from(await res.arrayBuffer());
    const tmpPath  = path.join(os.tmpdir(), `rag-tmp-${Date.now()}${ext}`);
    fs.writeFileSync(tmpPath, buf);
    try {
      const result = await parseOffice(tmpPath);
      return result.toText();
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  return await res.text();
}

// ── CHUNK TEXT ────────────────────────────────────────────────────────────────
function chunkText(text, sourceName) {
  // Normalise line endings; collapse 3+ blank lines to 2
  let cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // PPTX/DOCX often uses single newlines between slide elements.
  // Group every 5 lines into a "paragraph" so the chunker has material to work with.
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  const GROUP = 5;
  const grouped = [];
  for (let i = 0; i < lines.length; i += GROUP) {
    grouped.push(lines.slice(i, i + GROUP).join(' '));
  }
  cleaned = grouped.join('\n\n');

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.split(/\s+/).length > 4);

  const chunks = [];
  let current  = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.split(/\s+/).length > CHUNK_WORDS && current) {
      chunks.push({ text: current.trim(), source: sourceName });
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push({ text: current.trim(), source: sourceName });

  // Hard fallback: split by word count
  if (chunks.length === 0 && cleaned) {
    const words = cleaned.split(/\s+/);
    for (let i = 0; i < words.length; i += CHUNK_WORDS) {
      chunks.push({ text: words.slice(i, i + CHUNK_WORDS).join(' '), source: sourceName });
    }
  }

  return chunks;
}

// ── EMBEDDINGS ────────────────────────────────────────────────────────────────
async function createEmbeddings(texts) {
  const BATCH = 100;
  const all   = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res   = await fetch('https://api.openai.com/v1/embeddings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body:    JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
    const data = await res.json();
    all.push(...data.data.map(d => d.embedding));
    if (texts.length > BATCH) console.log(`   Embedded ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
  }
  return all;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📂 Listing files from Google Drive…\n');

  const files = await listFiles(FOLDER_ID);
  if (files.length === 0) {
    console.log('No files found in the Drive folder.');
    return;
  }
  console.log(`Found ${files.length} file(s):\n`);

  const allChunks = [];

  for (const file of files) {
    console.log(`📄 ${file.name}`);
    let content;
    try {
      content = await extractText(file);
    } catch (err) {
      console.log(`   ⚠  Error: ${err.message}\n`);
      continue;
    }
    if (!content?.trim()) { console.log('   ⚠  Skipped (no readable text)\n'); continue; }
    const chunks = chunkText(content, file.name);
    console.log(`   ✓ ${chunks.length} chunk(s)\n`);
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) { console.log('No text content found.'); return; }

  console.log(`🧠 Creating embeddings for ${allChunks.length} chunk(s)…`);
  const embeddings = await createEmbeddings(allChunks.map(c => c.text));

  const kb = allChunks.map((c, i) => ({ text: c.text, source: c.source, embedding: embeddings[i] }));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(kb));

  console.log(`\n✅ knowledge-base.json saved — ${kb.length} chunks from ${files.length} file(s).`);
  console.log('   Refresh the dashboard to apply the updated knowledge base.');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
