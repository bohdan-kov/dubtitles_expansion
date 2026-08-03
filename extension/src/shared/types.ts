/** Types shared by the popup, the service worker and the content script. */

// ── Settings (chrome.storage.sync) ───────────────────────────────────────────

export type SubtitleMode = 'ua' | 'bilingual';
export type SubtitleLayout = 'triple' | 'single';
/** `'auto'` fits the clip into its cue window; anything else is a fixed rate. */
export type DubSpeed = 'auto' | (string & {});

export interface Settings {
  enabled: boolean;
  mode: SubtitleMode;
  layout: SubtitleLayout;
  dub: boolean;
  voice: string;
  dubSpeed: DubSpeed;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'ua',
  layout: 'triple',
  dub: false,
  voice: 'uk-UA-OstapNeural',
  dubSpeed: 'auto',
};

// Popup appearance lives in ./theme.ts — it is popup-only state and never
// travels to the content script.

// ── Subtitles ────────────────────────────────────────────────────────────────

export interface Cue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

// ── Download jobs (worker → popup) ───────────────────────────────────────────

export type JobStatus = 'translating' | 'done' | 'error';

export interface Job {
  /** Track URL — the job's identity. */
  url: string;
  name: string;
  tabId: number | null;
  tabTitle: string;
  status: JobStatus;
  pct: number;
  error: string | null;
  cues: number;
  startedAt: number;
  updatedAt: number;
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** Worker → content script. */
export type WorkerMessage =
  | { type: 'TRANSLATION_START' }
  | { type: 'TRANSLATION_PROGRESS'; pct: number }
  | { type: 'TRANSLATED_SRT'; srt: string }
  | { type: 'TRANSLATION_ERROR'; error: string }
  | { type: 'TTS_META'; total: number }
  | { type: 'TTS_CUE'; id: string; startSec: number; endSec: number; audio: string }
  | { type: 'TTS_PROGRESS'; done: number; total: number }
  | { type: 'TTS_DONE' }
  | { type: 'TTS_ERROR'; error: string };

/** Popup → content script (a settings patch). */
export type SettingsMessage = { type: 'SETTINGS' } & Partial<Settings>;

/** Anything the content script may receive. */
export type ContentMessage = WorkerMessage | SettingsMessage;

/** Content script / popup → worker. */
export type RequestMessage =
  | { type: 'CONTENT_READY' }
  | { type: 'REQUEST_TTS'; srt: string; voice: string }
  | { type: 'CANCEL_TTS' }
  | { type: 'GET_JOBS' }
  | { type: 'CLEAR_FINISHED_JOBS' };

/** Reply to CONTENT_READY — lets a late content script catch up. */
export type ContentReadyResponse =
  | { status: 'idle' }
  | { status: 'translating'; pct: number }
  | { status: 'done'; srt: string }
  | { status: 'error'; error: string };

export interface JobsResponse {
  jobs: Job[];
}

// ── Local bridge ─────────────────────────────────────────────────────────────

export const SERVER_ORIGIN = 'http://127.0.0.1:17382';
