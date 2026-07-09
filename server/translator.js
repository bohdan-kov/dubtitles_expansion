'use strict';

require('dotenv').config();
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-5-nano';
const MAX_INPUT_CHARS = 4500;

// gpt-5-nano occasionally drops cues from a batch. Missed cues are retried in
// progressively smaller sub-batches (the model almost never drops a 1-3 cue
// batch), recursing until every cue is resolved or this depth is exhausted.
const MAX_RETRY_DEPTH = 4;
const RETRY_BATCH_SIZE = 4;

const SYSTEM_PROMPT = `You are a subtitle translator. Translate every cue to Ukrainian. Keep technical terms in English. You MUST return one item for EVERY input cue — exactly the same count and the same ids, never dropping, merging or reordering cues. Return ONLY a raw JSON object {"items":[{"id":<id>,"text":"<translation>"}]}, no explanation, no markdown.`;

// Transliteration is decoupled from translation: kept-English terms are collected
// at dub time and only the ones missing from the persistent dictionary are sent
// here, in one small batch. The voice reads the Cyrillic spelling so terms like
// "API"/"token" sound right; the on-screen subtitle keeps the English original.
const TRANSLIT_SYSTEM_PROMPT = `You decide how a Ukrainian text-to-speech voice should pronounce kept-English terms. Input is a JSON array of candidate terms. Return ONLY a raw JSON object mapping EVERY input term to a value (no explanation, no markdown). Keys must be EXACTLY the input terms.

DEFAULT TO PROVIDING A READING. Only return an empty string for a term that is UNMISTAKABLY one of: a common everyday English word, a 1-2 letter fragment, or transcription noise. When in doubt, give a reading.

For each term:
- Give its phonetic Cyrillic reading — how it SOUNDS in English, NEVER a Ukrainian translation of its meaning (e.g. "database" -> "дейтабейс", NOT "база даних"; "delete" -> "деліт", NOT "видалити"). Read acronyms letter-by-letter: "API" -> "Ей-Пі-Ай", "JSON" -> "Джейсон", "SDK" -> "Ес-Ді-Кей", "URL" -> "Ю-Ар-Ел". Read words by pronunciation: "token" -> "токен", "prompt" -> "промпт", "streaming" -> "стрімінг". Technical jargon, code identifiers (camelCase, snake_case, dotted), compound tech words and library/framework/API names ALWAYS get a reading: "useState" -> "юзСтейт", "webhook" -> "вебхук", "middleware" -> "мідлвеар", "async" -> "ейсінк".
- Return an empty string "" ONLY for an ordinary English word ("say", "thing", "inside", "right", "up", "habit"), a fragment ("ll", "al"), or transcription noise ("reres", "dotpost.git").`;

// The model sometimes double-escapes line breaks, so a literal "\n" (backslash + n)
// survives JSON.parse and shows up as text in the overlay. Turn such literal escape
// sequences back into real characters.
function cleanText(t) {
  if (typeof t !== 'string') return t;
  return t
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .trim();
}

function buildUserMessage(cues) {
  const slim = cues.map(c => ({ id: c.id, text: c.text }));
  return JSON.stringify(slim);
}

function splitIntoChunks(cues) {
  const chunks = [];
  let current = [];

  for (const cue of cues) {
    current.push(cue);
    if (buildUserMessage(current).length > MAX_INPUT_CHARS) {
      if (current.length > 1) {
        chunks.push(current.slice(0, -1));
        current = [cue];
      } else {
        chunks.push([...current]);
        current = [];
      }
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function translateAll(cues, onProgress) {
  const chunks = splitIntoChunks(cues);
  const startTime = Date.now();

  console.log(`[translator] Starting: ${cues.length} cues in ${chunks.length} chunk(s)`);
  onProgress?.(0, cues.length);

  if (chunks.length === 1) {
    const result = await translateBatch(chunks[0]);
    onProgress?.(cues.length, cues.length);
    console.log(`[translator] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    return result;
  }

  let done = 0;
  const parts = await Promise.all(chunks.map(chunk =>
    translateBatch(chunk).then(result => {
      done += chunk.length;
      onProgress?.(done, cues.length);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[translator] Progress: ${done}/${cues.length} (${Math.round(done / cues.length * 100)}%) — ${elapsed}s`);
      return result;
    })
  ));
  return parts.flat();
}

// ── Transliterate a batch of new terms (one small dedicated call) ─────────────
// `terms` is a deduped list of kept-English terms NOT yet in the persistent
// dictionary. Returns {term → Cyrillic reading}. On failure returns {} so dubbing
// just falls back to speaking the terms as-is.
async function transliterateTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return {};

  const userMessage = JSON.stringify(terms);
  console.log(`[translit] → ${terms.length} new term(s): ${terms.slice(0, 12).join(', ')}${terms.length > 12 ? '…' : ''}`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        reasoning_effort: 'minimal',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: TRANSLIT_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      });

      const raw = completion.choices[0].message.content.trim();
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const map = JSON.parse(cleaned);
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw new Error('Expected a JSON object of term→reading');
      }
      const usage = completion.usage;
      console.log(`[translit] ✓ ${Object.keys(map).length} reading(s) | in:${usage?.prompt_tokens} out:${usage?.completion_tokens} tokens`);
      return map;
    } catch (err) {
      console.error(`[translit] ✗ attempt ${attempt} failed: ${err.message}`);
      if (attempt === 2) return {};
      await sleep(2000);
    }
  }
  return {};
}

// One model call for a batch of cues. Returns a Map<id → translated text> of the
// cues the model actually returned (may be missing some — the caller retries
// those). Retries only on transport/parse failures, not on missed cues.
async function requestTranslation(cues) {
  const userMessage = buildUserMessage(cues);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const t = Date.now();
    try {
      const requestPayload = {
        model: MODEL,
        // Translation needs no chain-of-thought; minimal reasoning cuts the hidden
        // reasoning tokens (billed as output) and leaves more budget for the actual
        // answer, which also reduces truncated/dropped cues.
        reasoning_effort: 'minimal',
        // JSON mode guarantees syntactically valid output (no markdown fences, no
        // parse-failure retries). Pairs with the object-shaped SYSTEM_PROMPT.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      };

      const completion = await client.chat.completions.create(requestPayload);

      const raw = completion.choices[0].message.content.trim();
      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      const usage = completion.usage;

      console.log(`[translator] ✓ ${elapsed}s | in:${usage?.prompt_tokens} out:${usage?.completion_tokens} tokens`);

      // Strip markdown fences if model wraps in ```json
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

      let parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        parsed = parsed.items || parsed.cues || parsed.subtitles || parsed.translations || Object.values(parsed)[0];
      }

      if (!Array.isArray(parsed)) {
        throw new Error(`Expected array, got: ${JSON.stringify(parsed).slice(0, 100)}`);
      }
      if (parsed.length !== cues.length) {
        console.warn(`[translator] ⚠ count mismatch: expected ${cues.length}, got ${parsed.length} — using ID matching`);
      }

      // Keep only items whose id belongs to this batch and whose text is a
      // non-empty string, so a bogus/empty entry doesn't mask a dropped cue and
      // block its retry.
      const wanted = new Set(cues.map(c => String(c.id)));
      const byId = new Map();
      for (const p of parsed) {
        const id = String(p?.id);
        if (!wanted.has(id)) continue;
        const text = cleanText(p.text);
        if (typeof text === 'string' && text.trim()) byId.set(id, text);
      }
      return byId;

    } catch (err) {
      console.error(`[translator] ✗ attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) throw err;
      const is429 = err.message.includes('429') || err.status === 429;
      const waitMs = is429 ? 10000 : attempt * 3000;
      console.log(`[translator] waiting ${waitMs / 1000}s before retry…`);
      await sleep(waitMs);
    }
  }
}

// Translate a batch and guarantee every cue comes back translated. Cues the model
// drops are retried recursively in smaller sub-batches (RETRY_BATCH_SIZE), which
// the model handles far more reliably, until none are missed or MAX_RETRY_DEPTH is
// reached. Only then does a cue fall back to its original (English) text.
//
// `resolved` is a shared Set of ids that have received a real translation. It is
// threaded through the recursion so the top level can accurately report the cues
// that stayed English (a text comparison would misflag terms kept in English).
async function translateBatch(cues, depth = 0, resolved = new Set()) {
  console.log(`[translator] → ${cues.length} cues [${cues[0]?.start} .. ${cues[cues.length - 1]?.end}]${depth > 0 ? ` [retry d${depth}]` : ''}`);

  const byId = await requestTranslation(cues);
  const result = new Map(cues.map(orig => {
    const id = String(orig.id);
    const hit = byId.has(id);
    if (hit) resolved.add(id);
    return [id, { ...orig, text: hit ? byId.get(id) : orig.text }];
  }));

  const missed = cues.filter(c => !byId.has(String(c.id)));

  if (missed.length && depth < MAX_RETRY_DEPTH) {
    console.warn(`[translator] ⚠ ${missed.length} cue(s) missed — retrying in sub-batches (depth ${depth + 1})…`);
    for (let i = 0; i < missed.length; i += RETRY_BATCH_SIZE) {
      const sub = missed.slice(i, i + RETRY_BATCH_SIZE);
      try {
        const retried = await translateBatch(sub, depth + 1, resolved);
        for (const r of retried) result.set(String(r.id), r);
      } catch (retryErr) {
        console.warn(`[translator] ⚠ retry sub-batch failed: ${retryErr.message} — keeping original for those cues`);
      }
    }
  }

  if (depth === 0) {
    const stillMissed = cues.filter(c => !resolved.has(String(c.id)));
    if (stillMissed.length) {
      console.warn(`[translator] ⚠ ${stillMissed.length} cue(s) left untranslated after retries: ids ${stillMissed.map(c => c.id).join(', ')}`);
    }
  }

  const translated = cues.map(c => result.get(String(c.id)));
  console.log(`[translator] ← [${translated[0]?.start}] "${translated[0]?.text?.slice(0, 60)}"`);
  console.log(`[translator] ← [${translated[translated.length - 1]?.start}] "${translated[translated.length - 1]?.text?.slice(0, 60)}"`);
  return translated;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { translateAll, transliterateTerms };
