import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import * as esbuild from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

/** Files that ship to the browser untouched. */
const STATIC_FILES = ['manifest.json', 'content.css'];

/** Directories shipped as-is (extension icons referenced from the manifest). */
const STATIC_DIRS = ['icons'];

/**
 * The service worker and the content scripts are bundled separately as IIFEs:
 * MV3 content scripts can't be ES modules, and the worker must be a single
 * self-contained file. Rollup emits one format per build, so esbuild handles
 * these three entries while Vite builds the popup.
 */
const SCRIPT_ENTRIES = [
  { entry: 'src/background/index.ts', out: 'background.js' },
  { entry: 'src/content/index.ts', out: 'content.js' },
  { entry: 'src/content/inject.ts', out: 'inject.js' },
];

function buildExtensionScripts(isDev: boolean): Plugin {
  return {
    name: 'build-extension-scripts',
    apply: 'build',
    async closeBundle() {
      const outDir = resolve(root, 'dist');

      for (const file of STATIC_FILES) {
        const dest = resolve(outDir, file);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(resolve(root, file), dest);
      }
      for (const dir of STATIC_DIRS) {
        cpSync(resolve(root, dir), resolve(outDir, dir), { recursive: true });
      }

      await Promise.all(
        SCRIPT_ENTRIES.map(({ entry, out }) =>
          esbuild.build({
            entryPoints: [resolve(root, entry)],
            outfile: resolve(outDir, out),
            bundle: true,
            format: 'iife',
            platform: 'browser',
            target: 'chrome120',
            minify: !isDev,
            sourcemap: isDev ? 'inline' : false,
            legalComments: 'none',
            alias: { '@': resolve(root, 'src') },
          })
        )
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    // Relative asset URLs — the popup is loaded from chrome-extension://<id>/.
    base: './',
    plugins: [
      vue({
        // The shadcn components type their props off imported reka-ui types, and
        // compiler-sfc can only resolve those when it is handed a file system.
        script: {
          fs: {
            fileExists: (file) => existsSync(file),
            readFile: (file) => readFileSync(file, 'utf-8'),
            realpath: (file) => realpathSync(file),
          },
        },
      }),
      tailwindcss(),
      buildExtensionScripts(isDev),
    ],
    resolve: {
      alias: { '@': resolve(root, 'src') },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Chrome 120+ — the extension already relies on modern DOM APIs.
      target: 'chrome120',
      rollupOptions: {
        input: { popup: resolve(root, 'popup.html') },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  };
});
