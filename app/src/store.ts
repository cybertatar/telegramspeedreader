// Настройки и прогресс — в localStorage, разобранные книги — в IndexedDB (они большие).
// Внутри Telegram список книг и прогресс дублируются в облачное хранилище Telegram,
// чтобы на другом устройстве была та же библиотека и то же место в книге.

import { del, get, getMany, set } from 'idb-keyval';
import { thumbnail } from './book/cover';
import { cloudStorage, hasCloudStorage } from './telegram';
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

/**
 * Версия разбора книг. Номер слова в потоке зависит от разбора: если на другом
 * устройстве версия другая, место восстанавливаем по доле прочитанного.
 */
export const PARSER_VERSION = 2;

export interface Progress {
  pos: number;
  v?: number;
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

const lastPush = new Map<string, number>();
/** Прогресс в облако — не чаще раза в 10 секунд на книгу, но всегда на паузе (`force`). */
export function saveProgress(id: string, p: Progress, force = false) {
  const progress = { ...p, v: PARSER_VERSION };
  write(`tsr:pos:${id}`, progress);
  if (!hasCloudStorage || id === DEMO_ID) return;
  const now = Date.now();
  if (!force && now - (lastPush.get(id) ?? 0) < 10000) return;
  lastPush.set(id, now);
  cloudStorage.set(`p_${id}`, JSON.stringify(progress)).catch(() => undefined);
}

/**
 * Перед открытием книги: если на другом устройстве дочитали дальше по времени —
 * берём то место. При другой версии разбора — по доле прочитанного.
 */
export async function pullProgress(id: string, itemsCount?: number) {
  if (!hasCloudStorage || id === DEMO_ID) return;
  try {
    const raw = (await cloudStorage.get([`p_${id}`]))[`p_${id}`];
    if (!raw) return;
    const remote = JSON.parse(raw) as Progress;
    const local = loadProgress(id);
    if (local && local.at >= remote.at) return;
    if (remote.v !== PARSER_VERSION && itemsCount)
      remote.pos = Math.round(remote.share * (itemsCount - 1));
    write(`tsr:pos:${id}`, remote);
  } catch {
    /* нет сети — читаем с локального места */
  }
}

const demoMeta: BookMeta = {
  id: DEMO_ID,
  title: demoBook.title,
  author: demoBook.author,
  format: 'demo',
  addedAt: 0,
};

const readList = (): BookMeta[] => {
  try {
    return JSON.parse(localStorage.getItem('tsr:library') ?? '[]');
  } catch {
    return [];
  }
};

export function loadLibrary(): BookMeta[] {
  return [...readList().sort((a, b) => b.addedAt - a.addedAt), demoMeta];
}

/** Запись о книге в облаке Telegram: коротко, ключ `b_<id>` до 4 КБ. */
interface CloudMeta {
  t: string;
  a?: string;
  f: BookMeta['format'];
  id: string;
  n?: string;
  d: number;
}

/**
 * Сливает библиотеку с облаком: книги, добавленные на других устройствах,
 * появляются в списке (откроются, скачавшись из чата с ботом).
 */
export async function syncLibrary(): Promise<BookMeta[]> {
  if (!hasCloudStorage) return loadLibrary();
  try {
    const keys = (await cloudStorage.keys()).filter((k) => k.startsWith('b_'));
    const values = await cloudStorage.get(keys);
    const list = readList();
    const known = new Set(list.map((b) => b.id));
    for (const [key, raw] of Object.entries(values)) {
      const id = key.slice(2);
      if (known.has(id)) continue;
      try {
        const m = JSON.parse(raw) as CloudMeta;
        list.push({
          id,
          title: m.t,
          author: m.a,
          format: m.f,
          fileId: m.id,
          fileName: m.n,
          addedAt: m.d,
          remote: true,
        });
      } catch {
        /* битая запись — пропускаем */
      }
    }
    write('tsr:library', list);
  } catch {
    /* нет сети — показываем то, что есть на устройстве */
  }
  return loadLibrary();
}

export async function addBook(
  book: Book,
  source?: { fileId: string; fileName: string },
): Promise<BookMeta> {
  // Обложку уменьшаем и храним отдельно: полке не нужно грузить всю книгу.
  if (book.cover) {
    book.cover = await thumbnail(book.cover);
    await set(`cover:${book.id}`, book.cover);
  }
  await set(`book:${book.id}`, book);
  const prev = readList().find((b) => b.id === book.id);
  const meta: BookMeta = {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    addedAt: prev?.addedAt ?? Date.now(),
    fileId: source?.fileId ?? prev?.fileId,
    fileName: source?.fileName ?? prev?.fileName,
  };
  write('tsr:library', [...readList().filter((b) => b.id !== book.id), meta]);
  if (hasCloudStorage && meta.fileId) {
    const cloud: CloudMeta = {
      t: meta.title.slice(0, 300),
      a: meta.author?.slice(0, 200),
      f: meta.format,
      id: meta.fileId,
      n: meta.fileName?.slice(0, 200),
      d: meta.addedAt,
    };
    await cloudStorage.set(`b_${book.id}`, JSON.stringify(cloud)).catch(() => undefined);
  }
  return meta;
}

/** Удаляет книгу отовсюду: с устройства и из облачного списка (файл в чате остаётся). */
export async function removeBook(id: string) {
  await del(`book:${id}`);
  await del(`cover:${id}`);
  write(
    'tsr:library',
    readList().filter((b) => b.id !== id),
  );
  try {
    localStorage.removeItem(`tsr:pos:${id}`);
  } catch {
    /* ничего */
  }
  await cloudStorage.remove([`b_${id}`, `p_${id}`]).catch(() => undefined);
}

export async function loadBook(id: string): Promise<Book | undefined> {
  if (id === DEMO_ID) return demoBook;
  return get<Book>(`book:${id}`);
}

/** Обложки книг, скачанных на это устройство. */
export async function loadCovers(ids: string[]): Promise<Record<string, string>> {
  try {
    const values = await getMany<string | undefined>(ids.map((id) => `cover:${id}`));
    return Object.fromEntries(ids.flatMap((id, i) => (values[i] ? [[id, values[i]!]] : [])));
  } catch {
    return {};
  }
}

/** Книга, которую читают сейчас: открывали последней и ещё не дочитали. */
export function currentBook(books: BookMeta[]): BookMeta | undefined {
  let best: BookMeta | undefined;
  let at = 0;
  for (const b of books) {
    const p = loadProgress(b.id);
    if (p && p.at > at && p.share < 0.995) [best, at] = [b, p.at];
  }
  return best;
}
