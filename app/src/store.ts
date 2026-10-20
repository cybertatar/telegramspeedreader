// Настройки и прогресс — в localStorage, книги — в IndexedDB (они большие).
// Позже прогресс переедет на сервер, чтобы читать с телефона и компьютера.

import { del, get, set } from 'idb-keyval';
import { demoBook, DEMO_ID } from './book/demo';
import type { Book, BookMeta } from './book/types';
import type { FiguresMode } from './engine/player';

export interface Settings {
  wpm: number;
  mode: 'hold' | 'tap';
  figures: FiguresMode;
  rewind: boolean;
  ramp: boolean;
  pauseScale: number;
  fontSize: number;
}

export const defaultSettings: Settings = {
  wpm: 300,
  mode: 'hold',
  figures: 'stop',
  rewind: true,
  ramp: true,
  pauseScale: 1,
  fontSize: 40,
};

export interface Progress {
  pos: number;
  /** Доля прочитанного, для библиотеки. */
  share: number;
  /** Скорость у каждой книги своя: художественную читают быстрее. */
  wpm?: number;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим или полное хранилище — живём без сохранения */
  }
}

export const loadSettings = () => read<Settings>('tsr:settings', defaultSettings);
export const saveSettings = (s: Settings) => write('tsr:settings', s);

export const loadProgress = (id: string): Progress | null => {
  const p = read<Progress | null>(`tsr:pos:${id}`, null);
  return p && typeof p.pos === 'number' ? p : null;
};
export const saveProgress = (id: string, p: Progress) => write(`tsr:pos:${id}`, p);

const demoMeta: BookMeta = {
  id: DEMO_ID,
  title: demoBook.title,
  author: demoBook.author,
  format: 'demo',
  addedAt: 0,
};

export function loadLibrary(): BookMeta[] {
  let list: BookMeta[] = [];
  try {
    list = JSON.parse(localStorage.getItem('tsr:library') ?? '[]');
  } catch {
    /* пусто */
  }
  return [...list.sort((a, b) => b.addedAt - a.addedAt), demoMeta];
}

export async function addBook(book: Book): Promise<BookMeta> {
  await set(`book:${book.id}`, book);
  const meta: BookMeta = {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    addedAt: Date.now(),
  };
  write('tsr:library', [...loadLibrary().filter((b) => b.id !== DEMO_ID), meta]);
  return meta;
}

export async function removeBook(id: string) {
  await del(`book:${id}`);
  write(
    'tsr:library',
    loadLibrary().filter((b) => b.id !== id && b.id !== DEMO_ID),
  );
  try {
    localStorage.removeItem(`tsr:pos:${id}`);
  } catch {
    /* ничего */
  }
}

export async function loadBook(id: string): Promise<Book | undefined> {
  if (id === DEMO_ID) return demoBook;
  return get<Book>(`book:${id}`);
}
