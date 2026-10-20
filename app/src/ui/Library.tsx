import { useRef, useState } from 'preact/hooks';
import { importFile, UnsupportedFormat } from '../book/import';
import { ScannedPdf } from '../book/pdf/errors';
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
  const [busy, setBusy] = useState<{ text: string; share: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Удаление в два касания: первое превращает корзину в «Удалить».
  const [confirming, setConfirming] = useState<string | null>(null);

  const onFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    setBusy({ text: 'Открываю файл', share: 0 });
    setError(null);
    try {
      const book = await importFile(file, (text, share) => setBusy({ text, share }));
      if (!book.chapters.length) throw new Error('В файле не нашлось текста');
      const meta = await addBook(book);
      props.onChange();
      props.onOpen(meta.id);
    } catch (err) {
      setError(
        err instanceof UnsupportedFormat
          ? 'Этот формат пока не открывается. Подойдут EPUB, FB2, PDF и TXT.'
          : err instanceof ScannedPdf
            ? 'В этом PDF нет текста — похоже, это скан. Распознавание сканов добавим позже.'
            : `Не получилось открыть файл: ${(err as Error).message}`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="library">
      <header class="library-head">
        <h1>Книги</h1>
        <button class="btn btn-primary" disabled={!!busy} onClick={() => input.current?.click()}>
          <IconPlus />
          Добавить
        </button>
        <input
          ref={input}
          type="file"
          accept=".epub,.fb2,.pdf,.txt,application/epub+zip,application/pdf,text/plain"
          hidden
          onChange={onFile}
        />
      </header>
      {busy && (
        <div class="importing" role="status">
          <span>{busy.text}</span>
          <span class="book-progress">
            <i style={{ width: `${busy.share * 100}%` }} />
          </span>
        </div>
      )}
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
        Открываются EPUB, FB2, PDF и TXT. Книга разбирается прямо на телефоне и никуда не
        отправляется.
      </p>
    </div>
  );
}
