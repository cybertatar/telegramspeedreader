// Разбор файлов прямо в браузере: TXT и FB2. EPUB и PDF будет разбирать сервер
// (PDF — PyMuPDF: колонтитулы, переносы, колонки, вырезка формул и схем).

import type { Block, Book, Chapter, Figure } from './types';

export class UnsupportedFormat extends Error {}

const CHAPTER_LINE =
  /^\s*(глава|часть|chapter|part|пролог|эпилог|prologue|epilogue)(\s+[\p{L}\p{N}.]+)?[.:!]?(\s.*)?$/iu;

/** Русские TXT и FB2 часто в windows-1251. */
export function decode(bytes: Uint8Array, hint?: string): string {
  if (hint) {
    try {
      return new TextDecoder(hint).decode(bytes);
    } catch {
      /* неизвестная кодировка — пробуем дальше */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function parseTxt(text: string, fileName: string): Book {
  text = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  let paras = text.split(/\n\s*\n/);
  // Нет пустых строк между абзацами — абзац на строку.
  if (paras.length < 3) paras = text.split('\n');
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  for (const raw of paras) {
    const t = clean(raw);
    if (!t) continue;
    if (t.length < 80 && CHAPTER_LINE.test(t)) {
      current = { title: t, blocks: [] };
      chapters.push(current);
      continue;
    }
    if (!current) {
      current = { title: 'Начало', blocks: [] };
      chapters.push(current);
    }
    current.blocks.push({ type: 'p', text: t });
  }
  const title = fileName.replace(/\.[^.]+$/, '');
  if (chapters.length === 1) chapters[0].title = title;
  return {
    id: newId(),
    title,
    format: 'txt',
    pageMode: 'virtual',
    chapters: chapters.filter((c) => c.blocks.length),
    figures: {},
  };
}

export function parseFb2(xml: string): Book {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Файл FB2 повреждён');
  const byTag = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagName(tag));
  const first = (el: Element | Document, tag: string) => el.getElementsByTagName(tag)[0];

  const info = first(doc, 'title-info');
  const title = clean(first(info ?? doc, 'book-title')?.textContent ?? 'Без названия');
  const authorEl = info && first(info, 'author');
  const author = authorEl
    ? clean(
        ['first-name', 'last-name'].map((t) => first(authorEl, t)?.textContent ?? '').join(' '),
      ) || undefined
    : undefined;

  const binaries = new Map<string, string>();
  for (const b of byTag(doc, 'binary')) {
    const type = b.getAttribute('content-type') ?? 'image/jpeg';
    binaries.set(
      b.getAttribute('id') ?? '',
      `data:${type};base64,${clean(b.textContent ?? '').replace(/ /g, '')}`,
    );
  }

  const figures: Record<string, Figure> = {};
  const bodies = byTag(doc, 'body');
  const body = bodies.find((b) => !b.getAttribute('name')) ?? bodies[0];
  if (!body) throw new Error('В FB2 нет текста');

  const chapters: Chapter[] = [];
  const text = (el: Element) => clean(el.textContent ?? '');

  // Обходит содержимое секции; вложенные секции — подзаголовки той же главы.
  const walk = (el: Element, out: Block[]) => {
    for (const child of Array.from(el.children)) {
      switch (child.localName) {
        case 'title':
        case 'subtitle': {
          const t = text(child);
          if (t) out.push({ type: 'h', text: t });
          break;
        }
        case 'p':
        case 'v':
        case 'text-author': {
          const t = text(child);
          if (t) out.push({ type: 'p', text: t });
          break;
        }
        case 'image': {
          const href =
            child.getAttribute('l:href') ??
            child.getAttribute('xlink:href') ??
            child.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
            '';
          const src = binaries.get(href.replace(/^#/, ''));
          if (!src) break;
          const id = `img${Object.keys(figures).length + 1}`;
          figures[id] = { id, src, caption: child.getAttribute('title') ?? undefined };
          out.push({ type: 'figure', id });
          break;
        }
        case 'table': {
          const rows = byTag(child, 'tr').map((tr) => Array.from(tr.children).map(text));
          if (rows.length) out.push({ type: 'table', rows });
          break;
        }
        case 'section':
        case 'poem':
        case 'stanza':
        case 'cite':
        case 'epigraph':
          walk(child, out);
          break;
      }
    }
  };

  const childSections = (el: Element) =>
    Array.from(el.children).filter((c) => c.localName === 'section');
  const titleOf = (sec: Element) => {
    const t = Array.from(sec.children).find((c) => c.localName === 'title');
    return t ? text(t) : '';
  };
  // Часть книги без своего текста, только с главами внутри, — разворачиваем в главы.
  const collect = (sec: Element, part: string) => {
    const inner = childSections(sec);
    const hasText = Array.from(sec.children).some((c) =>
      ['p', 'image', 'poem', 'cite', 'table'].includes(c.localName),
    );
    if (inner.length && !hasText) {
      const name = titleOf(sec);
      for (const s of inner) collect(s, name || part);
      return;
    }
    const blocks: Block[] = [];
    walk(sec, blocks);
    // Заголовок секции уже в названии главы — не читаем его дважды.
    const name = titleOf(sec);
    if (name && blocks[0]?.type === 'h') blocks.shift();
    const t = name || `Глава ${chapters.length + 1}`;
    chapters.push({ title: part && part !== t ? `${part}. ${t}` : t, blocks });
  };

  const sections = childSections(body);
  if (!sections.length) {
    const blocks: Block[] = [];
    walk(body, blocks);
    chapters.push({ title, blocks });
  }
  for (const sec of sections) collect(sec, '');

  const book: Book = {
    id: newId(),
    title,
    author,
    format: 'fb2',
    pageMode: 'virtual',
    chapters: chapters.filter((c) => c.blocks.length),
    figures,
  };
  attachCaptions(book);
  return book;
}

const CAPTION = /^(рис(?:унок)?\.?|илл\.?|fig(?:ure)?\.?)\s*(\d+(?:\.\d+)*)[.:]?\s*(.*)$/iu;

/**
 * Абзац «Рис. 3.2. Схема…» сразу после картинки — это подпись: забираем номер
 * и текст в иллюстрацию, чтобы ссылки «см. рис. 3.2» на неё работали.
 */
export function attachCaptions(book: Book) {
  for (const ch of book.chapters) {
    for (let i = 0; i < ch.blocks.length; i++) {
      const b = ch.blocks[i];
      if (b.type !== 'figure') continue;
      const next = ch.blocks[i + 1];
      const m = next?.type === 'p' ? next.text.match(CAPTION) : null;
      if (!m) continue;
      const fig = book.figures[b.id];
      fig.label = m[2];
      fig.caption = m[3] || fig.caption;
      ch.blocks.splice(i + 1, 1);
    }
  }
}

export async function importFile(file: File): Promise<Book> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === 'txt') return parseTxt(decode(bytes), file.name);
  if (ext === 'fb2') {
    const head = new TextDecoder('ascii').decode(bytes.slice(0, 200));
    const enc = head.match(/encoding=["']([\w-]+)["']/i)?.[1];
    return parseFb2(decode(bytes, enc));
  }
  throw new UnsupportedFormat(ext ?? '');
}
