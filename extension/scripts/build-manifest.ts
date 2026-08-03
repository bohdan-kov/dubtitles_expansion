/**
 * Generates manifest.json from the single source of truth in src/shared/sites.ts.
 *
 * Run directly (Node strips the types) or, more usually, via `npm run build`:
 *   node scripts/build-manifest.ts
 *
 * host_permissions and content_scripts.matches are derived from the registry,
 * so adding a platform never means hand-editing the manifest.
 */
import { writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_SITES } from '../src/shared/sites.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const unique = (arr: string[]): string[] => [...new Set(arr)];

/**
 * Toolbar / extensions-page icon — the same mark as the popup header
 * (lucide "languages" on the primary surface). Source: icons/icon.svg.
 */
const ICONS = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

const autoCaptionSites = SUPPORTED_SITES.filter((site) => site.autoCaptions);

const manifest = {
  manifest_version: 3,
  name: 'Dubtitles',
  version: '1.0.0',
  description: 'Ukrainian subtitles and voice-over for online video courses',

  icons: ICONS,

  permissions: ['storage', 'webRequest'],

  host_permissions: unique(SUPPORTED_SITES.flatMap((site) => site.hostPermissions)),

  background: {
    service_worker: 'background.js',
  },

  content_scripts: [
    {
      matches: unique(SUPPORTED_SITES.flatMap((site) => site.pageMatches)),
      // One bundle — the site registry is compiled into it.
      js: ['content.js'],
      css: ['content.css'],
      run_at: 'document_idle',
    },
    // MAIN-world script for sites that fetch their subtitle track only on CC
    // enable (autoCaptions). Omitted entirely if no site needs it.
    ...(autoCaptionSites.length
      ? [
          {
            matches: unique(autoCaptionSites.flatMap((site) => site.pageMatches)),
            js: ['inject.js'],
            world: 'MAIN',
            run_at: 'document_idle',
          },
        ]
      : []),
  ],

  action: {
    default_popup: 'popup.html',
    default_title: 'Dubtitles',
    default_icon: ICONS,
  },
};

const out = resolve(root, 'manifest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Wrote ${relative(process.cwd(), out)} from ${SUPPORTED_SITES.length} site(s):`);
for (const site of SUPPORTED_SITES) console.log(`  • ${site.id} — ${site.label}`);
