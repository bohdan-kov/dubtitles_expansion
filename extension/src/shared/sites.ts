/**
 * Single source of truth for every supported platform.
 *
 * ── To add a new site ────────────────────────────────────────────────────────
 *   1. Append one entry to SUPPORTED_SITES below.
 *   2. Run `npm run build` — it regenerates manifest.json from this file and
 *      rebuilds the bundles.
 *   3. Reload the extension at chrome://extensions (manifest changes need a
 *      full reload, not just a page refresh).
 */

export interface SiteConfig {
  /** Unique slug (internal). */
  id: string;
  /** Human-readable name. */
  label: string;
  /**
   * Every origin the extension must read — the course page AND the
   * subtitle/caption CDN (fed into manifest host_permissions).
   */
  hostPermissions: string[];
  /** Where the content script + overlay run (manifest matches). */
  pageMatches: string[];
  /** Subtitle track requests to intercept (webRequest filter). */
  trackUrls: string[];
  /**
   * CSS selector(s) for the element the overlay lives inside; MUST survive
   * fullscreen. First match wins.
   */
  player: string[];
  /** CSS selector(s) for the <video> element. First match wins. */
  video: string[];
  /**
   * True for Video.js sites that only fetch their subtitle track once CC is
   * enabled. Adds a MAIN-world script (inject.ts) that turns the track on in
   * `hidden` mode so the .vtt is fetched without showing the original text.
   */
  autoCaptions?: boolean;
}

export const SUPPORTED_SITES: SiteConfig[] = [
  {
    id: 'skilljar',
    label: 'Skilljar (e.g. Anthropic courses)',
    hostPermissions: ['*://*.skilljar.com/*', '*://assets-jpcust.jwpsrv.com/*'],
    pageMatches: ['*://*.skilljar.com/*'],
    trackUrls: ['*://assets-jpcust.jwpsrv.com/tracks/*.srt'],
    player: ['.plyr', '.jwplayer'],
    video: ['video.sbtl-video', '.jwplayer video'],
  },
  {
    id: 'frontendmasters',
    label: 'FrontendMasters / master.dev',
    // The platform rebranded from frontendmasters.com to master.dev (captions
    // now come from captions.master.dev) — keep the old domains too so nothing
    // breaks if they linger. `*://*.master.dev/*` also covers the bare domain
    // in Chrome match-pattern semantics, but pageMatches needs the bare entry
    // separately: siteForUrl's regex conversion requires it.
    hostPermissions: [
      '*://frontendmasters.com/*',
      '*://captions.frontendmasters.com/*',
      '*://*.master.dev/*',
    ],
    pageMatches: ['*://frontendmasters.com/*', '*://master.dev/*', '*://*.master.dev/*'],
    trackUrls: ['*://captions.frontendmasters.com/*.vtt', '*://*.master.dev/*.vtt'],
    player: ['.video-js'],
    video: ['video.vjs-tech'],
    autoCaptions: true, // Video.js fetches the .vtt only when CC is enabled
  },
];

// ── Helpers (shared by the worker, the content script and the manifest build) ─

/**
 * Convert a Chrome match pattern (e.g. `*://*.skilljar.com/*`) to a RegExp.
 * Sufficient for our simple `*://host/path` patterns.
 */
export function matchPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); // escape regex specials (keep *)
  const withWildcards = escaped.replace(/\*/g, '.*'); // * → .*
  return new RegExp('^' + withWildcards + '$');
}

/** The site config whose pageMatches matches the given URL, or null. */
export function siteForUrl(url: string): SiteConfig | null {
  return (
    SUPPORTED_SITES.find((site) =>
      site.pageMatches.some((pattern) => matchPatternToRegExp(pattern).test(url))
    ) ?? null
  );
}

/** Union of every site's track-URL patterns (for the webRequest filter). */
export function allTrackUrls(): string[] {
  return [...new Set(SUPPORTED_SITES.flatMap((site) => site.trackUrls))];
}
