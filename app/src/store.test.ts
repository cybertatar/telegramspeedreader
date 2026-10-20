import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from './book/types';

// Облако Telegram и IndexedDB в тестах — в памяти.
const cloud = new Map<string, string>();
const idb = new Map<string, unknown>();
vi.mock('./telegram', () => ({
  hasCloudStorage: true,
  cloudStorage: {
    keys: async () => [...cloud.keys()],
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => cloud.has(k)).map((k) => [k, cloud.get(k)!])),
    set: async (k: string, v: string) => void cloud.set(k, v),
    remove: async (keys: string[]) => keys.forEach((k) => cloud.delete(k)),
  },
}));
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => void idb.set(k, v),
  del: async (k: string) => void idb.delete(k),
}));

const store = await import('./store');

const book: Book = {
  id: 'UID1',
  title: 'Pro Git',
  author: 'Scott Chacon',
  format: 'pdf',
  pageMode: 'source',
  chapters: [{ title: 'Начало', blocks: [{ type: 'p', text: 'Текст.' }] }],
  figures: {},
};

describe('синхронизация через облако Telegram', () => {
  beforeEach(() => {
    cloud.clear();
    idb.clear();
    localStorage.clear();
  });

  it('книга из чата попадает в облачный список и появляется на другом устройстве', async () => {
    await store.addBook(book, { fileId: 'FID1', fileName: 'progit.pdf' });
    expect(JSON.parse(cloud.get('b_UID1')!)).toMatchObject({ t: 'Pro Git', id: 'FID1', f: 'pdf' });

    // «Другое устройство»: локально пусто, облако то же.
    localStorage.clear();
    idb.clear();
    const list = await store.syncLibrary();
    expect(list[0]).toMatchObject({ id: 'UID1', title: 'Pro Git', fileId: 'FID1', remote: true });
  });

  it('открывает книгу с более позднего места из облака', async () => {
    store.saveProgress('UID1', { pos: 10, share: 0.1, at: 1000 }, true);
    cloud.set(
      'p_UID1',
      JSON.stringify({ pos: 500, share: 0.5, at: 2000, v: store.PARSER_VERSION }),
    );
    await store.pullProgress('UID1');
    expect(store.loadProgress('UID1')).toMatchObject({ pos: 500 });

    // Локальное место новее — облако его не перетирает.
    store.saveProgress('UID1', { pos: 700, share: 0.7, at: Date.now() }, true);
    cloud.set('p_UID1', JSON.stringify({ pos: 1, share: 0, at: 5, v: store.PARSER_VERSION }));
    await store.pullProgress('UID1');
    expect(store.loadProgress('UID1')).toMatchObject({ pos: 700 });
  });

  it('удаление убирает книгу и её прогресс из облака', async () => {
    await store.addBook(book, { fileId: 'FID1', fileName: 'progit.pdf' });
    store.saveProgress('UID1', { pos: 1, share: 0, at: 1 }, true);
    await store.removeBook('UID1');
    expect([...cloud.keys()]).toEqual([]);
    expect(store.loadLibrary().map((b) => b.id)).toEqual(['demo']);
  });
});
