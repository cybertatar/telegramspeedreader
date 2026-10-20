import { useEffect, useState } from 'preact/hooks';
import type { Book } from '../book/types';
import { loadBook, loadLibrary, loadSettings, saveSettings, type Settings } from '../store';
import { Library } from './Library';
import { Reader } from './Reader';

export function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [books, setBooks] = useState(loadLibrary);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ссылка из бота откроет сразу нужную книгу (?book=<id>).
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('book');
    if (id) open(id);
  }, []);

  const open = async (id: string) => {
    const b = await loadBook(id);
    if (b) setBook(b);
    else setError('Книга не найдена');
  };

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
    <>
      {error && <p class="error">{error}</p>}
      <Library books={books} onOpen={open} onChange={() => setBooks(loadLibrary())} />
    </>
  );
}
