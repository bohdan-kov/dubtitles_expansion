import { allTrackUrls } from '@/shared/sites';
import type {
  ContentReadyResponse,
  Job,
  JobStatus,
  RequestMessage,
  WorkerMessage,
} from '@/shared/types';
import { SERVER_ORIGIN } from '@/shared/types';

// Per-tab state: avoid re-translating the same URL.
interface TabState {
  inProgress: Set<string>;
  done: Set<string>;
  status: 'idle' | JobStatus;
  pct: number;
  srt: string | null;
  error: string | null;
}

const tabState = new Map<number, TabState>();

function getState(tabId: number): TabState {
  let state = tabState.get(tabId);
  if (!state) {
    state = {
      inProgress: new Set(),
      done: new Set(),
      status: 'idle',
      pct: 0,
      srt: null,
      error: null,
    };
    tabState.set(tabId, state);
  }
  return state;
}

// ── Per-video job registry (drives the popup's progress list) ─────────────────
// Keyed by track URL so each intercepted subtitle file is one independent job.
const jobs = new Map<string, Job>();

/** Derive a friendly label from a track URL (decoded filename, sans extension). */
function jobName(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return last.replace(/\.(srt|vtt)$/i, '') || url;
  } catch {
    return url;
  }
}

/**
 * Best-effort page title for context in the list (which course/lesson the
 * subtitle belongs to). Resolves to '' if the tab is gone.
 */
function getTabTitle(tabId: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        resolve(chrome.runtime.lastError ? '' : tab?.title || '');
      });
    } catch {
      resolve('');
    }
  });
}

/** Create or update a job, stamping updatedAt so the popup can sort by recency. */
function upsertJob(url: string, patch: Partial<Job>): Job {
  const prev: Job = jobs.get(url) ?? {
    url,
    name: jobName(url),
    tabId: null,
    tabTitle: '',
    status: 'translating',
    pct: 0,
    error: null,
    cues: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  const job: Job = { ...prev, ...patch, updatedAt: Date.now() };
  jobs.set(url, job);
  return job;
}

/**
 * Active jobs float to the top, then errors, then finished — recent first
 * within each group.
 */
function jobSort(a: Job, b: Job): number {
  const rank = (s: JobStatus) => (s === 'translating' ? 0 : s === 'error' ? 1 : 2);
  return rank(a.status) - rank(b.status) || b.updatedAt - a.updatedAt;
}

function deleteTabJobs(tabId: number): void {
  for (const [url, job] of jobs) {
    if (job.tabId === tabId) jobs.delete(url);
  }
}

/**
 * Reflect a tab's translation state on the toolbar icon with a compact badge:
 *   N (orange) — N active translations · ✓ (green) — finished · ! (red) — error
 * Per-tab so each course tab shows only its own state; no badge when idle.
 */
function refreshBadge(tabId: number | null | undefined): void {
  if (typeof tabId !== 'number' || tabId < 0) return;
  let active = 0;
  let done = 0;
  let error = 0;
  for (const job of jobs.values()) {
    if (job.tabId !== tabId) continue;
    if (job.status === 'translating') active++;
    else if (job.status === 'error') error++;
    else if (job.status === 'done') done++;
  }

  let text = '';
  let color = '#c04a00';
  if (active > 0) {
    text = String(active);
  } else if (error > 0) {
    text = '!';
    color = '#e74c3c';
  } else if (done > 0) {
    text = '✓';
    color = '#27ae60';
  }

  try {
    chrome.action.setBadgeText({ tabId, text });
    if (text) {
      chrome.action.setBadgeBackgroundColor({ tabId, color });
      chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
    }
  } catch {
    /* tab went away mid-update */
  }
}

// ── English detection ────────────────────────────────────────────────────────

function looksEnglish(rawSRT: string): boolean {
  // Strip subtitle scaffolding (WEBVTT header, cue numbers, timestamps, tags)
  // so the heuristic sees real spoken text, not formatting — VTT files front-load
  // a lot of timecodes that would otherwise crowd out the sampled words.
  const textOnly = rawSRT
    .replace(/^WEBVTT[^\n]*/i, '')
    .replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->.*$/gm, '') // timestamp lines
    .replace(/^\s*\d+\s*$/gm, '') // bare cue-number lines
    .replace(/<[^>]+>/g, '') // inline tags
    .toLowerCase();

  const sample = textOnly.slice(0, 2000);
  const hits = [
    ' the ', ' is ', ' are ', ' we ', ' to ', ' of ', ' in ', ' and ',
    ' you ', ' that ', ' it ', " i'm ", ' this ', ' for ', ' on ', ' so ',
  ].filter((word) => sample.includes(word));
  return hits.length >= 3;
}

// ── Server-sent events ───────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  /** Shape depends on `event` — narrowed by the caller. */
  data: unknown;
}

/** Yield `event:`/`data:` pairs from a text/event-stream body. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data: unknown = JSON.parse(line.slice(6));
        if (currentEvent) yield { event: currentEvent, data };
        currentEvent = null;
      }
    }
  }
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// ── Core: fetch SRT + translate + notify content script ──────────────────────

async function processURL(tabId: number, url: string): Promise<void> {
  const state = getState(tabId);

  // Skip if already done or currently translating this URL.
  if (state.done.has(url)) {
    console.log('[bg] Skip (already translated this session):', url);
    return;
  }
  if (state.inProgress.has(url)) {
    console.log('[bg] Skip (translation already in progress):', url);
    return;
  }
  state.inProgress.add(url);

  const notify = (msg: WorkerMessage) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

  try {
    // 1. Fetch the SRT — background workers bypass CORS/mixed-content restrictions.
    console.log('[bg] Fetching track:', url);
    const srtResp = await fetch(url);
    if (!srtResp.ok) throw new Error(`SRT fetch ${srtResp.status}`);
    const rawSRT = await srtResp.text();
    console.log(
      `[bg] Track fetched: ${rawSRT.length} chars, ${(rawSRT.match(/-->/g) || []).length} cues`
    );

    // 2. Skip non-English tracks.
    if (!looksEnglish(rawSRT)) {
      console.log('[bg] Skipping non-English:', url);
      state.inProgress.delete(url);
      return;
    }

    console.log('[bg] Translating:', url);
    state.status = 'translating';
    state.pct = 0;
    upsertJob(url, {
      tabId,
      tabTitle: await getTabTitle(tabId),
      status: 'translating',
      pct: 0,
      error: null,
      startedAt: Date.now(),
    });
    refreshBadge(tabId);
    notify({ type: 'TRANSLATION_START' });

    // 3. Send to local translation server (SSE stream).
    console.log('[bg] POST /translate →', url);
    const transResp = await fetch(`${SERVER_ORIGIN}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawSRT,
    }).catch((err: unknown) => {
      // Typical when the local server isn't running — make that explicit.
      throw new Error(
        `translate server unreachable (${errorMessage(err)}) — is server/index.js running?`
      );
    });
    console.log('[bg] /translate response:', transResp.status);

    if (!transResp.ok) {
      const err = (await transResp.json().catch(() => ({ error: transResp.statusText }))) as {
        error?: string;
      };
      throw new Error(err.error || transResp.statusText);
    }
    if (!transResp.body) throw new Error('translate response had no body');

    for await (const { event, data } of sseEvents(transResp.body)) {
      if (event === 'progress') {
        const { done, total } = data as { done: number; total: number };
        const pct = Math.round((done / total) * 100);
        state.pct = pct;
        upsertJob(url, { status: 'translating', pct });
        notify({ type: 'TRANSLATION_PROGRESS', pct });
      } else if (event === 'result') {
        const { srt } = data as { srt: string };
        state.done.add(url);
        state.inProgress.delete(url);
        state.status = 'done';
        state.srt = srt;
        upsertJob(url, {
          status: 'done',
          pct: 100,
          cues: (srt.match(/-->/g) || []).length,
        });
        refreshBadge(tabId);
        notify({ type: 'TRANSLATED_SRT', srt });
        console.log('[bg] Done:', url);
        return;
      } else if (event === 'error') {
        throw new Error((data as { error: string }).error);
      }
    }

    // The stream ended without a `result` event — the job would otherwise hang
    // in "translating" forever with no trace. Surface it as an error.
    throw new Error('translate stream ended without result');
  } catch (err) {
    const message = errorMessage(err);
    state.inProgress.delete(url);
    state.status = 'error';
    state.error = message;
    // Only surface a job entry if we'd already committed to translating this
    // track — a fetch/skip failure before that shouldn't litter the list.
    if (jobs.has(url)) {
      upsertJob(url, { status: 'error', error: message });
      refreshBadge(tabId);
    }
    console.error('[bg] Error:', message);
    notify({ type: 'TRANSLATION_ERROR', error: message });
  }
}

// ── Voice-over (TTS) streaming proxy ─────────────────────────────────────────
// The page is https, the bridge is http://127.0.0.1 — fetching it from a content
// script trips mixed-content. So the service worker does the fetch and relays
// each synthesised cue (base64 MP3) to the content script, which rebuilds it
// into a blob and plays it in sync. One in-flight job per tab; a new request
// (e.g. voice change) aborts the previous one.
const ttsAbort = new Map<number, AbortController>();

async function streamTTS(tabId: number, srt: string, voice: string): Promise<void> {
  ttsAbort.get(tabId)?.abort();
  const ctrl = new AbortController();
  ttsAbort.set(tabId, ctrl);

  const notify = (msg: WorkerMessage) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

  try {
    const url = `${SERVER_ORIGIN}/tts?voice=${encodeURIComponent(voice || '')}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: srt,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({ error: resp.statusText }))) as {
        error?: string;
      };
      throw new Error(err.error || resp.statusText);
    }
    if (!resp.body) throw new Error('tts response had no body');

    for await (const { event, data } of sseEvents(resp.body)) {
      if (event === 'meta') {
        notify({ type: 'TTS_META', total: (data as { total: number }).total });
      } else if (event === 'cue') {
        const cue = data as { id: string; startSec: number; endSec: number; audio: string };
        notify({
          type: 'TTS_CUE',
          id: cue.id,
          startSec: cue.startSec,
          endSec: cue.endSec,
          audio: cue.audio,
        });
      } else if (event === 'progress') {
        const { done, total } = data as { done: number; total: number };
        notify({ type: 'TTS_PROGRESS', done, total });
      } else if (event === 'done') {
        notify({ type: 'TTS_DONE' });
      } else if (event === 'error') {
        throw new Error((data as { error: string }).error);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return; // superseded — silent
    const message = errorMessage(err);
    console.error('[bg] TTS error:', message);
    notify({ type: 'TTS_ERROR', error: message });
  } finally {
    if (ttsAbort.get(tabId) === ctrl) ttsAbort.delete(tabId);
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    msg: RequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: ContentReadyResponse | { jobs: Job[] } | { ok: true }) => void
  ) => {
    // Content script asks to synthesise voice-over for the (translated) SRT.
    if (msg.type === 'REQUEST_TTS') {
      const tabId = sender.tab?.id;
      if (tabId) streamTTS(tabId, msg.srt, msg.voice);
      return false;
    }
    // Content script asks to cancel an in-flight voice-over (dub turned off).
    if (msg.type === 'CANCEL_TTS') {
      const tabId = sender.tab?.id;
      if (tabId) {
        ttsAbort.get(tabId)?.abort();
        ttsAbort.delete(tabId);
      }
      return false;
    }
    // Popup: fetch the live job list for the progress view.
    if (msg.type === 'GET_JOBS') {
      sendResponse({ jobs: [...jobs.values()].sort(jobSort) });
      return false;
    }
    // Popup: drop finished/errored jobs, keep anything still translating.
    if (msg.type === 'CLEAR_FINISHED_JOBS') {
      const affected = new Set<number | null>();
      for (const [url, job] of jobs) {
        if (job.status !== 'translating') {
          affected.add(job.tabId);
          jobs.delete(url);
        }
      }
      affected.forEach(refreshBadge);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type !== 'CONTENT_READY') return false;
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    const state = tabState.get(tabId);
    if (!state || state.status === 'idle') {
      sendResponse({ status: 'idle' });
    } else if (state.status === 'translating') {
      sendResponse({ status: 'translating', pct: state.pct });
    } else if (state.status === 'done') {
      sendResponse({ status: 'done', srt: state.srt ?? '' });
    } else if (state.status === 'error') {
      sendResponse({ status: 'error', error: state.error ?? '' });
    }
    return false;
  }
);

// ── Intercept .srt / .vtt requests ───────────────────────────────────────────

chrome.webRequest.onBeforeRequest.addListener(
  // Observe-only: the listener never blocks, hence the bare `undefined` returns.
  (details): undefined => {
    console.log('[bg] Track request intercepted:', details.url, 'tabId=', details.tabId);
    if (details.tabId < 0) {
      console.log('[bg] Skip (request not tied to a tab):', details.url);
      return undefined;
    }
    processURL(details.tabId, details.url);
    return undefined;
  },
  // Track-URL patterns are derived from the site registry (shared/sites.ts).
  { urls: allTrackUrls() }
);

// If this line is the only one in the service-worker console, no subtitle
// request matched the patterns above — check shared/sites.ts trackUrls vs the
// actual network request on the course page.
console.log('[bg] Service worker started. Watching track URLs:', allTrackUrls());

// ── Cleanup on navigation / tab close ────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabState.delete(tabId);
    // Cancel any voice-over still streaming for the old page.
    ttsAbort.get(tabId)?.abort();
    ttsAbort.delete(tabId);
    // Keep in-flight translations — they continue in the background across
    // navigation, so dropping them here would hide a download that's still
    // running. Only clear this tab's already-finished/errored jobs.
    for (const [url, job] of jobs) {
      if (job.tabId === tabId && job.status !== 'translating') jobs.delete(url);
    }
    refreshBadge(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  deleteTabJobs(tabId);
  ttsAbort.get(tabId)?.abort();
  ttsAbort.delete(tabId);
});
