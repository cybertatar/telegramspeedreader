import { useEffect, useState } from 'preact/hooks';
import { importBytes, UnsupportedFormat, type ImportProgress } from '../book/import';
import { ScannedPdf } from '../book/pdf/errors';
import type { Book, BookMeta } from '../book/types';
import { cloudEnabled, CloudError, downloadBook, uploadBook } from '../cloud';
import {
  addBook,
  loadBook,
  loadLibrary,
  loadSettings,
  pullProgress,
  removeBook,
  saveSettings,
  syncLibrary,
  type Settings,
} from '../store';
import { Library } from './Library';
import { Reader } from './Reader';

function errorText(e: unknown) {
  if (e instanceof UnsupportedFormat)
    return 'Этот формат пока не открывается. Подойдут EPUB, FB2, PDF и TXT.';
  if (e instanceof ScannedPdf)
    return 'В этом PDF нет текста — похоже, это скан. Распознавание сканов добавим позже.';
  if (e instanceof CloudError) return e.message;
  return `Не получилось открыть книгу: ${(e as Error).message}`;
}

interface Source {
  id: string;
  fileId: string;
  fileName: string;
}

export function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [books, setBooks] = useState(loadLibrary);
  const [book, setBook] = useState<Book | null>(null);
  const [busy, setBusy] = useState<{ text: string; share: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const show = async (b: Book) => {
    await pullProgress(b.id);
    setBook(b);
  };

  // Долгая операция с прогрессом и понятной ошибкой.
  const run = async (task: (progress: ImportProgress) => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy({ text: 'Открываю книгу', share: 0 });
    try {
      await task((text, share) => setBusy({ text, share }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  /** Книга из чата с ботом: скачиваем, разбираем на устройстве, открываем. */
  const openRemote = (src: Source) =>
    run(async (progress) => {
      const local = await loadBook(src.id);
      if (local) return show(local);
      if (!cloudEnabled) throw new CloudError('Книги из чата открываются внутри Telegram.');
      progress('Скачиваю книгу из чата', 0);
      const bytes = await downloadBook(src.fileId);
      const parsed = await importBytes(bytes, src.fileName, progress);
      parsed.id = src.id;
      await addBook(parsed, { fileId: src.fileId, fileName: src.fileName });
      setBooks(loadLibrary());
      await show(parsed);
    });

  /** Книга, добавленная кнопкой: разбираем и, если есть бот, кладём файл в чат. */
  const addFile = (file: File) =>
    run(async (progress) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await importBytes(bytes, file.name, progress);
      if (!parsed.chapters.length) throw new Error('в файле не нашлось текста');
      let source: { fileId: string; fileName: string } | undefined;
      if (cloudEnabled) {
        progress('Сохраняю книгу в чат с ботом', 1);
        try {
          const up = await uploadBook(bytes, file.name);
          parsed.id = up.uid;
          source = { fileId: up.file_id, fileName: file.name };
        } catch {
          setNotice('Книга сохранена только на этом устройстве: не получилось отправить её в чат.');
        }
      }
      await addBook(parsed, source);
      setBooks(loadLibrary());
      await show(parsed);
    });

  const open = async (meta: BookMeta) => {
    const local = await loadBook(meta.id);
    if (local) return show(local);
    if (meta.fileId)
      return openRemote({
        id: meta.id,
        fileId: meta.fileId,
        fileName: meta.fileName ?? meta.title,
      });
    setError('Этой книги нет на устройстве.');
  };

  useEffect(() => {
    syncLibrary().then(setBooks);
    // Кнопка «Читать» в чате открывает приложение со ссылкой на файл.
    const q = new URLSearchParams(location.search);
    const fileId = q.get('file');
    const uid = q.get('uid');
    if (fileId && uid) openRemote({ id: uid, fileId, fileName: q.get('name') ?? 'book' });
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  };

  if (book)
    return (
      <Reader
        key={book.id}
        book={book}
        settings={settings}
        onSettings={updateSettings}
        onExit={() => {
          setBook(null);
          setBooks(loadLibrary());
        }}
      />
    );

  return (
    <Library
      books={books}
      busy={busy}
      error={error}
      notice={notice}
      cloud={cloudEnabled}
      onOpen={open}
      onAdd={addFile}
      onRemove={async (id) => {
        await removeBook(id);
        setBooks(loadLibrary());
      }}
    />
  );
}
