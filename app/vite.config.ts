/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Номер сборки: приложение сверяет его с version.json на сайте и перезагружается,
// если Telegram показал старую версию из кэша.
const BUILD = process.env.GITHUB_SHA?.slice(0, 12) ?? `dev-${Date.now()}`;

const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ build: BUILD }),
    });
  },
});

// `--mode preview` собирает один HTML-файл для превью-артефакта.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [preact(), ...(mode === 'preview' ? [viteSingleFile()] : [versionFile()])],
  test: { environment: 'jsdom' },
}));
