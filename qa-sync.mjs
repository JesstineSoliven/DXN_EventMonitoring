/**
 * qa-sync.mjs
 * Run: node qa-sync.mjs
 *
 * Reads knowledge/predefined-qa.txt, embeds each question with OpenAI,
 * and saves qa-knowledge.json for exact-answer chatbot lookups.
 *
 * Re-run whenever you add or update entries in predefined-qa.txt.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { createRequire } from 'module';
const require    = createRequire(import.meta.url);
const _cfg        = require('./config.json');
const OPENAI_API_KEY = _cfg.OPENAI_API_KEY;

const INPUT_FILE  = path.join(__dirname, 'knowledge', 'predefined-qa.txt');
const OUTPUT_FILE = path.join(__dirname, 'qa-knowledge.json');

// ── PARSE Q&A PAIRS ───────────────────────────────────────────────────────────
function parseQA(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs = [];
  let current  = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^Q:/i.test(line)) {
      if (current && current.question) pairs.push(current);
      current = { question: line.replace(/^Q:/i, '').trim(), answer: '' };
    } else if (/^A:/i.test(line)) {
      if (current) current.answer = line.replace(/^A:/i, '').trim();
    } else if (line && current && current.answer !== '') {
      current.answer += ' ' + line;
    } else if (line && current && current.answer === '' && !current.question) {
      // stray line before any Q: — ignore
    }
  }
  if (current && current.question) pairs.push(current);

  return pairs.filter(p => p.question && p.answer);
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
  }
  return all;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.log(`No file found at ${INPUT_FILE} — create it first (see knowledge/README.txt).`);
    return;
  }

  const raw  = fs.readFileSync(INPUT_FILE, 'utf-8');
  const pairs = parseQA(raw);

  if (pairs.length === 0) {
    console.log('No valid Q&A pairs found in predefined-qa.txt.');
    return;
  }
  console.log(`Found ${pairs.length} Q&A pair(s).`);

  console.log('🧠 Creating embeddings…');
  const embeddings = await createEmbeddings(pairs.map(p => p.question));

  const qa = pairs.map((p, i) => ({ question: p.question, answer: p.answer, embedding: embeddings[i] }));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(qa));

  console.log(`\n✅ qa-knowledge.json saved — ${qa.length} pair(s).`);
  console.log('   Refresh the dashboard to apply the updated Q&A list.');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
