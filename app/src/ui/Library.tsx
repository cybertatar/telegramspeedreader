import { useRef, useState } from 'preact/hooks';
import { DEMO_ID } from '../book/demo';
import type { BookMeta } from '../book/types';
import { loadProgress } from '../store';
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
  busy: { text: string; share: number } | null;
  error: string | null;
  notice: string | null;
  /** Есть бот: книги синхронизируются через чат. */
  cloud: boolean;
  onOpen: (meta: BookMeta) => void;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Удаление в два касания: первое превращает корзину в «Удалить».
  const [confirming, setConfirming] = useState<string | null>(null);
  const { busy } = props;

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
          onChange={(e) => {
            const el = e.target as HTMLInputElement;
            const file = el.files?.[0];
            el.value = '';
            if (file) props.onAdd(file);
          }}
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
      {props.error && <p class="error">{props.error}</p>}
      {props.notice && <p class="notice">{props.notice}</p>}
      <ul class="books">
        {props.books.map((b) => {
          const share = loadProgress(b.id)?.share ?? 0;
          return (
            <li>
              <button class="book" disabled={!!busy} onClick={() => props.onOpen(b)}>
                <span class="book-title">{b.title}</span>
                <span class="book-meta">
                  {[b.author, FORMAT[b.format], b.remote ? 'скачается из чата' : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span class="book-progress" aria-label={`Прочитано ${Math.round(share * 100)}%`}>
                  <i style={{ width: `${share * 100}%` }} />
                </span>
              </button>
              {b.id !== DEMO_ID &&
                (confirming === b.id ? (
                  <button
                    class="btn btn-danger"
                    onClick={() => {
                      setConfirming(null);
                      props.onRemove(b.id);
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
        Открываются EPUB, FB2, PDF и TXT. Книга разбирается прямо на телефоне.
        {props.cloud
          ? ' Можно и прислать файл боту в чат — книга появится здесь на всех устройствах.'
          : ''}
      </p>
    </div>
  );
}
