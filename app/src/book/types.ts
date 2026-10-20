// Единый формат книги. Любой формат (TXT, FB2, позже EPUB и PDF с сервера)
// приводится к нему, и читалка работает со всеми одинаково.

export type Block =
  | { type: 'p'; text: string; page?: number }
  /** Подзаголовок внутри главы: читается потоком, после него пауза длиннее. */
  | { type: 'h'; text: string; page?: number }
  | { type: 'figure'; id: string; page?: number }
  | { type: 'code'; text: string; caption?: string; label?: string; page?: number }
  | { type: 'table'; rows: string[][]; caption?: string; label?: string; page?: number };

export interface Figure {
  id: string;
  /** Номер для ссылок из текста: «1.2» у «Рис. 1.2». */
  label?: string;
  caption?: string;
  /** Картинка или data: URL. У PDF — вырезка участка страницы. */
  src: string;
  /** У PDF таблицы и формулы тоже вырезаются картинками. */
  kind?: 'figure' | 'table' | 'formula';
}

export interface Chapter {
  title: string;
  blocks: Block[];
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  format: 'demo' | 'txt' | 'fb2' | 'epub' | 'pdf';
  /**
   * `source` — страницы из самой книги (у PDF настоящие, `page` у блоков);
   * `virtual` — страница = WORDS_PER_PAGE слов, номера не зависят от скорости и шрифта.
   */
  pageMode: 'virtual' | 'source';
  chapters: Chapter[];
  figures: Record<string, Figure>;
  /** Подписи страниц PDF («xii», «147»); индекс — `page - 1`. */
  pageLabels?: string[];
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  format: Book['format'];
  addedAt: number;
  /** Файл в чате с ботом: по нему книгу можно скачать на другом устройстве. */
  fileId?: string;
  fileName?: string;
  /** Книга есть в облачном списке, но на этом устройстве ещё не скачана. */
  remote?: boolean;
}
