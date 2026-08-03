# Dubtitles

Chrome extension that adds Ukrainian subtitles and neural voice-over to online video courses.
Platform-agnostic: every supported site is described in a single registry, so
adding a new one is a one-file change.

Supported platforms (see `extension/src/shared/sites.ts`):
- **Skilljar** (e.g. Anthropic courses) — JW Player, `.srt` tracks
- **FrontendMasters** — Video.js, `.vtt` captions

## Requirements

- Node.js 18+
- Google Chrome
- An `OPENAI_API_KEY` (the local server translates via OpenAI `gpt-5-nano`)

## Installation

### 1. Start the local translation server

```bash
cd server
echo "OPENAI_API_KEY=sk-..." > .env
npm install
npm start
```

The server runs on `http://127.0.0.1:17382`.
Translated subtitles are cached in `~/.course-subs-ua/` — each video is only translated once.

### 2. Build the Chrome extension

The popup is a Vue 3 app built with Vite, Tailwind CSS v4 and
[shadcn-vue](https://shadcn-vue.com) components, so it has to be built once:

```bash
cd extension
npm install
npm run build      # regenerates manifest.json, then bundles into extension/dist
```

Use `npm run dev` while working on the UI — it rebuilds `dist/` on every change
(reload the extension at `chrome://extensions` to pick the new bundle up).

### 3. Load it in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder (the build output, not `extension/`)

### 4. Watch a course

Open any lesson on a supported platform (e.g.
[anthropic.skilljar.com](https://anthropic.skilljar.com) or
[frontendmasters.com](https://frontendmasters.com)).
Ukrainian subtitles appear automatically when the video loads (~10s first time, instant from cache).
Turn on **Озвучення** in the popup to add the neural Ukrainian voice-over on top
(the original audio ducks while a line is spoken).

> **FrontendMasters note:** captions are fetched from `captions.frontendmasters.com`
> only once CC is enabled. The extension enables it automatically (in `hidden`
> mode, so no English text shows) via `inject.js` — a MAIN-world script for
> Video.js sites flagged `autoCaptions` in `sites.js`. No manual CC needed.

## Adding another platform

Everything platform-specific lives in **one file** — `extension/src/shared/sites.ts`. To add a site:

1. Append an entry to `SUPPORTED_SITES` in `extension/src/shared/sites.ts`:
   ```ts
   {
     id: 'udemy',
     label: 'Udemy',
     hostPermissions: ['*://*.udemy.com/*', '*://*.udemycdn.com/*'],
     pageMatches: ['*://*.udemy.com/*'],
     trackUrls: ['*://*.udemycdn.com/*.vtt'],   // the subtitle request to intercept
     player: ['.video-player'],                 // overlay container (survives fullscreen)
     video: ['video'],                          // the <video> element
   }
   ```
2. Rebuild — this regenerates the manifest from the registry and refreshes `dist/`:
   ```bash
   cd extension && npm run build
   ```
3. **Reload** the extension at `chrome://extensions` (a page refresh is not enough —
   manifest changes require a full extension reload).

The SRT/VTT parser on the server (`server/srt.js`) already handles both formats,
so most sites need no server changes.

## How it works

```
Browser intercepts the subtitle track request (.srt / .vtt)   ← urls from shared/sites.ts
  → the service worker fetches the EN subtitle file
    → sends it to the local Node.js server (POST /translate)
      → server translates via OpenAI gpt-5-nano (terms preserved via glossary)
        → translated SRT returned (streamed) and cached by SHA256
          → the content script renders the Ukrainian overlay, synced to video.currentTime
            → with voice-over on: POST /tts streams Edge neural audio per cue,
              cached by SHA256, played in sync while the original audio ducks
```

## Troubleshooting

**"⚠ Сервер недоступний"** — start the server: `cd server && npm start`

**Subtitles don't appear** — open the extension's **service worker** console at
`chrome://extensions` and look for `[bg] Translating: …`. No line means the track
request wasn't intercepted (check `trackUrls` in `src/shared/sites.ts`); `Skipping non-English`
means the language heuristic rejected it.

**Translation quality** — edit `server/glossary.json` to add terms that should not be translated.

**Port conflict** — change port: `PORT=17400 npm start` and update `SERVER_ORIGIN` in
`extension/src/shared/types.ts` — the worker, the content script and the popup all read it.

## Extension source

Everything under `extension/` is TypeScript; `dist/` is the only thing Chrome loads.

```
extension/
  popup.html               Vite entry for the popup
  content.css              overlay styling (plain CSS — injected into the host page)
  scripts/build-manifest.ts generates manifest.json from the site registry
  src/
    App.vue                the whole popup: settings cards + download queue
    main.ts                mounts the popup, mirrors prefers-color-scheme
    components/ui/         shadcn-vue components (owned code — edit freely)
    composables/           chrome.storage settings, server health, job polling
    styles/globals.css     design tokens (shadcn "new-york", neutral, light + dark)
    background/index.ts    service worker: intercept → translate → TTS relay
    content/index.ts       overlay, cue sync, dub playback
    content/inject.ts      MAIN-world Video.js caption enabler
    shared/sites.ts        the site registry + match helpers
    shared/types.ts        settings, cues, jobs, message unions, SERVER_ORIGIN
```

`npm run build` produces `dist/`: Vite bundles the popup, esbuild bundles the
three scripts as IIFEs (MV3 content scripts can't be ES modules), and
`manifest.json`, `content.css` and `icons/` are copied over.

Components come from the shadcn-vue registry:

```bash
cd extension
npx shadcn-vue@latest add dialog      # drops the component into src/components/ui/
```

The registry's MCP server is configured in `.mcp.json` at the repo root, so Claude Code
can add and compose components directly (restart Claude Code to pick it up).
The popup follows the browser's colour scheme — `main.ts` mirrors
`prefers-color-scheme` onto the `.dark` class shadcn's palette hangs off.
