import { useRef, useState } from 'preact/hooks';
import { importFile, UnsupportedFormat } from '../book/import';
import type { BookMeta } from '../book/types';
import { DEMO_ID } from '../book/demo';
import { addBook, loadProgress, removeBook } from '../store';
import { IconPlus, IconTrash } from './icons';

const FORMAT: Record<BookMeta['format'], string> = {
  demo: 'Знакомство',
  txt: 'TXT',
  fb2: 'FB2',
  epub: 'EPUB',
  pdf: 'PDF',
};

export function Library(props: {
  books: BookMeta[];
  onOpen: (id: string) => void;
  onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Удаление в два касания: первое превращает корзину в «Удалить».
  const [confirming, setConfirming] = useState<string | null>(null);

  const onFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const book = await importFile(file);
      if (!book.chapters.length) throw new Error('В файле не нашлось текста');
      const meta = await addBook(book);
      props.onChange();
      props.onOpen(meta.id);
    } catch (err) {
      setError(
        err instanceof UnsupportedFormat
          ? 'EPUB и PDF научимся открывать на следующем шаге — через сервер. Пока подойдут TXT и FB2.'
          : `Не получилось открыть файл: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="library">
      <header class="library-head">
        <h1>Книги</h1>
        <button class="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          <IconPlus />
          {busy ? 'Открываю…' : 'Добавить'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".txt,.fb2,.epub,.pdf,text/plain"
          hidden
          onChange={onFile}
        />
      </header>
      {error && <p class="error">{error}</p>}
      <ul class="books">
        {props.books.map((b) => {
          const share = loadProgress(b.id)?.share ?? 0;
          return (
            <li>
              <button class="book" onClick={() => props.onOpen(b.id)}>
                <span class="book-title">{b.title}</span>
                <span class="book-meta">
                  {[b.author, FORMAT[b.format]].filter(Boolean).join(' · ')}
                </span>
                <span class="book-progress" aria-label={`Прочитано ${Math.round(share * 100)}%`}>
                  <i style={{ width: `${share * 100}%` }} />
                </span>
              </button>
              {b.id !== DEMO_ID &&
                (confirming === b.id ? (
                  <button
                    class="btn btn-danger"
                    onClick={async () => {
                      setConfirming(null);
                      await removeBook(b.id);
                      props.onChange();
                    }}
                    onBlur={() => setConfirming(null)}
                  >
                    Удалить
                  </button>
                ) : (
                  <button
                    class="icon-btn"
                    aria-label={`Удалить «${b.title}»`}
                    onClick={() => setConfirming(b.id)}
                  >
                    <IconTrash />
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      <p class="library-note">
        Сейчас открываются TXT и FB2. EPUB, PDF и загрузка через бота — скоро.
      </p>
    </div>
  );
}
