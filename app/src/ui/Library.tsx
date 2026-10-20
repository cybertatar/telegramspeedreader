import { useEffect, useRef, useState } from 'preact/hooks';
import { DEMO_ID } from '../book/demo';
import type { BookMeta } from '../book/types';
import { currentBook, loadCovers, loadProgress } from '../store';
import { Cover } from './Cover';
import { IconPlus } from './icons';
import { Sheet } from './Sheet';

const percent = (id: string) => Math.round((loadProgress(id)?.share ?? 0) * 100);

/** Долгое нажатие на обложку открывает действия с книгой. */
function useLongPress(onLong: () => void) {
  const timer = useRef(0);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLong();
      }, 550);
    },
    onPointerMove: (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: Event) => {
      e.preventDefault();
      cancel();
      fired.current = true;
      onLong();
    },
    /** После долгого нажатия обычный клик не открывает книгу. */
    wasLong: () => fired.current,
  };
}

function ShelfItem(props: {
  meta: BookMeta;
  cover?: string;
  disabled: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const { meta } = props;
  const { wasLong, ...press } = useLongPress(props.onActions);
  const share = percent(meta.id);
  return (
    <li>
      <button
        class="shelf-item"
        disabled={props.disabled}
        onClick={() => !wasLong() && props.onOpen()}
        {...press}
      >
        <Cover meta={meta} src={props.cover} />
        {meta.remote && <span class="cover-badge">в чате</span>}
        <span class="shelf-progress" aria-label={`Прочитано ${share}%`}>
          <i style={{ width: `${share}%` }} />
        </span>
        <span class="shelf-title">{meta.title}</span>
        {meta.author && <span class="shelf-author">{meta.author}</span>}
      </button>
    </li>
  );
}

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
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<BookMeta | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { busy, books } = props;

  useEffect(() => {
    loadCovers(books.map((b) => b.id)).then(setCovers);
  }, [books]);

  const current = currentBook(books);
  const closeActions = () => {
    setActions(null);
    setConfirming(false);
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

      {current && (
        <section class="now">
          <button class="now-cover" disabled={!!busy} onClick={() => props.onOpen(current)}>
            <Cover meta={current} src={covers[current.id]} />
          </button>
          <div class="now-info">
            <span class="now-label">Читаю сейчас</span>
            <b class="now-title">{current.title}</b>
            {current.author && <span class="now-author">{current.author}</span>}
            <span class="book-progress">
              <i style={{ width: `${percent(current.id)}%` }} />
            </span>
            <span class="now-share">Прочитано {percent(current.id)}%</span>
            <button
              class="btn btn-primary now-go"
              disabled={!!busy}
              onClick={() => props.onOpen(current)}
            >
              Продолжить
            </button>
          </div>
        </section>
      )}

      <h2 class="shelf-head">
        Полка <span>{books.length}</span>
      </h2>
      <ul class="shelf">
        {books.map((b) => (
          <ShelfItem
            meta={b}
            cover={covers[b.id]}
            disabled={!!busy}
            onOpen={() => props.onOpen(b)}
            onActions={() => setActions(b)}
          />
        ))}
      </ul>

      <p class="library-note">
        Открываются EPUB, FB2, PDF и TXT — книга разбирается прямо на телефоне.
        {props.cloud
          ? ' Можно и прислать файл боту в чат: книга появится здесь на всех устройствах.'
          : ''}{' '}
        Чтобы удалить книгу, подержите палец на обложке.
      </p>

      {actions && (
        <Sheet title={actions.title} onClose={closeActions}>
          <div class="actions">
            <button
              class="btn btn-primary"
              onClick={() => {
                closeActions();
                props.onOpen(actions);
              }}
            >
              Открыть
            </button>
            {actions.id !== DEMO_ID &&
              (confirming ? (
                <>
                  <p class="hint-small">
                    Книга пропадёт с полки на всех устройствах. Файл в чате с ботом останется — из
                    него книгу можно вернуть.
                  </p>
                  <button
                    class="btn btn-danger"
                    onClick={() => {
                      props.onRemove(actions.id);
                      closeActions();
                    }}
                  >
                    Да, удалить
                  </button>
                </>
              ) : (
                <button class="btn" onClick={() => setConfirming(true)}>
                  Удалить с полки
                </button>
              ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
