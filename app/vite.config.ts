/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode preview` собирает один HTML-файл для превью-артефакта.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  test: { environment: 'jsdom' },
}));
