// Превращает книгу в поток показа: слова по одному и «стоп-карточки»
// (иллюстрации, листинги, таблицы), которые словами показывать бессмысленно.

import type { Block, Book } from '../book/types';

export const WORDS_PER_PAGE = 250;
/** Слова длиннее режутся на части: за один показ глаз длинное слово не схватывает. */
const MAX_CHUNK = 13;
/**
 * Однострочный код короче — не карточка, а один показ в потоке: в технических книгах
 * таких команд сотни, и останавливаться на каждой невыносимо.
 */
export const INLINE_CODE = 40;

export const isInlineCode = (b: Block) =>
  b.type === 'code' && !b.label && !b.text.includes('\n') && b.text.trim().length <= INLINE_CODE;

export interface WordItem {
  kind: 'word';
  /** Что показать: слово или кусок длинного слова. */
  text: string;
  /** Слово целиком для текста на паузе; у продолжения разрезанного слова пусто. */
  ctx?: string;
  chapter: number;
  /** Индекс в `Stream.blocks`. */
  block: number;
  sentenceStart: boolean;
  /** Вес слова без знаков препинания (длина, цифры): 1 — обычное слово. */
  weight: number;
  /** Пауза за знаки препинания и конец абзаца, масштабируется настройкой. */
  pause: number;
  page: number;
  /** Ключ карточки, на которую слово ссылается («см. рис. 2.1»). */
  mention?: string;
  /** Короткая команда из книги («$ git init»): показывается целиком моноширинным. */
  mono?: boolean;
}

export interface CardItem {
  kind: 'card';
  cardType: 'figure' | 'code' | 'table';
  key: string;
  /** Подпись для кнопок и оглавления: «Рис. 2.1», «Листинг 3». */
  title: string;
  source: Block;
  chapter: number;
  block: number;
  page: number;
}

export type Item = WordItem | CardItem;

export interface StreamBlock {
  chapter: number;
  source: Block;
  /** Диапазон элементов потока [start, end). */
  start: number;
  end: number;
}

export interface StreamChapter {
  title: string;
  start: number;
  end: number;
  /** Индексы карточек главы в потоке. */
  cards: number[];
}

export interface Stream {
  book: Book;
  items: Item[];
  blocks: StreamBlock[];
  chapters: StreamChapter[];
  pageCount: number;
  /** Префиксные суммы весов и пауз — для «минут до конца главы». */
  cumWeight: Float64Array;
  cumPause: Float64Array;
}

const SENTENCE_END = /[.!?…]["»”’')\]]*$/u;
const CLAUSE_END = /[,;:)]["»”’]*$/u;
const LONE_DASH = /^[—–-]+$|^…+$/u;
const ABBREVIATIONS = new Set(
  'рис. см. ср. т. е. д. п. стр. гл. табл. илл. им. г. гг. в. вв. др. пр. напр. т.е. т.д. т.п. fig. e.g. i.e. etc. vs. p. pp. mr. mrs. dr. no. ch.'.split(
    ' ',
  ),
);

const MENTION =
  /(?<![\p{L}\p{N}])(рис(?:унок|унка|унке|унку|унком)?\.?|илл\.?|fig(?:ure)?\.?|листинг[а-я]*|listing|табл(?:ица|ицы|ице|ицу|ицей)?\.?|table|eqn?\.?|equation|формул[а-я]*)\s*\(?(\d+(?:\.\d+)*)/giu;

/** Тип ссылки для ключа: у формул свой ряд номеров («Eqn. (1)», «формула (3)»). */
function mentionKind(word: string): CardItem['cardType'] | 'formula' {
  const w = word.toLowerCase();
  if (w.startsWith('eq') || w.startsWith('формул')) return 'formula';
  if (w.startsWith('лист') || w.startsWith('list')) return 'code';
  if (w.startsWith('табл') || w.startsWith('table')) return 'table';
  return 'figure';
}

const KIND_TITLE: Record<CardItem['cardType'], [string, string]> = {
  figure: ['Рис.', 'Иллюстрация'],
  code: ['Листинг', 'Листинг'],
  table: ['Таблица', 'Таблица'],
};

interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/\S+/gu)) {
    const tok = { text: m[0], start: m.index, end: m.index + m[0].length };
    const prev = out[out.length - 1];
    // Одинокое тире или многоточие отдельным показом — пустая трата времени.
    if (prev && LONE_DASH.test(tok.text)) {
      prev.text += '\u00a0' + tok.text;
      prev.end = tok.end;
    } else out.push(tok);
  }
  return out;
}

function isSentenceStart(prev: string | undefined, cur: string): boolean {
  if (!prev) return true;
  if (!SENTENCE_END.test(prev)) return false;
  if (ABBREVIATIONS.has(prev.toLowerCase())) return false;
  return /^[\p{Lu}\p{N}«"“„(—–-]/u.test(cur);
}

/** Вес слова по длине и цифрам: длинное и числа держатся дольше. */
export function wordWeight(text: string): number {
  const core = text.replace(/[^\p{L}\p{N}]/gu, '');
  let w = 1;
  if (core.length > 7) w += Math.min(0.6, (core.length - 7) * 0.06);
  if (/\p{N}/u.test(core)) w += 0.3;
  return w;
}

export function punctuationPause(text: string): number {
  if (SENTENCE_END.test(text)) return 1;
  if (CLAUSE_END.test(text) || / [—–]$/u.test(text)) return 0.5;
  return 0;
}

/** Режет длинное слово: «интернационализация» → «интернацио-», «нализация». */
export function splitLong(word: string): string[] {
  const lead = word.match(/^[^\p{L}\p{N}]*/u)![0];
  const trail = word.slice(lead.length).match(/[^\p{L}\p{N}]*$/u)![0];
  const core = word.slice(lead.length, word.length - trail.length);
  if (core.length <= MAX_CHUNK) return [word];
  const parts: string[] = [];
  for (const piece of core.split(/(?<=-)/u)) {
    if (piece.length <= MAX_CHUNK) {
      parts.push(piece);
      continue;
    }
    const n = Math.ceil(piece.length / 10);
    const size = Math.ceil(piece.length / n);
    for (let i = 0; i < piece.length; i += size) {
      const chunk = piece.slice(i, i + size);
      parts.push(i + size < piece.length && !chunk.endsWith('-') ? chunk + '-' : chunk);
    }
  }
  parts[0] = lead + parts[0];
  parts[parts.length - 1] += trail;
  return parts;
}

function cardOf(
  block: Block,
  book: Book,
): { type: CardItem['cardType']; label?: string; formula?: boolean } | null {
  if (block.type === 'figure') {
    // Таблицы и формулы из PDF вырезаны картинками, но называются по-своему.
    const fig = book.figures[block.id];
    if (fig?.kind === 'table') return { type: 'table', label: fig.label };
    return { type: 'figure', label: fig?.label, formula: fig?.kind === 'formula' };
  }
  if (block.type === 'code' || block.type === 'table')
    return { type: block.type, label: block.label };
  return null;
}

const keyOf = (type: CardItem['cardType'] | 'formula', label: string) => `${type}:${label}`;
const keyType = (c: NonNullable<ReturnType<typeof cardOf>>) => (c.formula ? 'formula' : c.type);

export function buildStream(book: Book): Stream {
  const items: Item[] = [];
  const blocks: StreamBlock[] = [];
  const chapters: StreamChapter[] = [];
  let words = 0;
  let sourcePage = 1;

  book.chapters.forEach((chapter, ci) => {
    // Где в главе стоит каждая карточка с номером и где на неё впервые сослались.
    // Если ссылка раньше — карточка показывается в конце предложения со ссылкой,
    // а не там, где картинку оставила вёрстка (в PDF рисунок часто на соседней странице).
    const placedAt = new Map<string, number>();
    chapter.blocks.forEach((b, bi) => {
      const c = cardOf(b, book);
      if (c?.label) placedAt.set(keyOf(keyType(c), c.label), bi);
    });
    const deferred = new Set<string>();
    const firstMention = new Map<string, number>();
    chapter.blocks.forEach((b, bi) => {
      if (b.type !== 'p') return;
      for (const m of b.text.matchAll(MENTION)) {
        const key = keyOf(mentionKind(m[1]), m[2]);
        if (!firstMention.has(key)) firstMention.set(key, bi);
      }
    });
    for (const [key, bi] of firstMention) {
      const at = placedAt.get(key);
      if (at !== undefined && bi < at) deferred.add(key);
    }
    const shown = new Set<string>();
    const sourceBlockOf = (key: string) => chapter.blocks[placedAt.get(key)!];

    const sc: StreamChapter = { title: chapter.title, start: items.length, end: 0, cards: [] };
    const page = () =>
      book.pageMode === 'virtual' ? Math.floor(words / WORDS_PER_PAGE) + 1 : sourcePage;

    const pushCard = (source: Block, blockIndex: number) => {
      const c = cardOf(source, book)!;
      const key = c.label ? keyOf(keyType(c), c.label) : `${c.type}@${ci}.${blockIndex}`;
      const [short, long] = KIND_TITLE[c.type];
      sc.cards.push(items.length);
      items.push({
        kind: 'card',
        cardType: c.type,
        key,
        title: c.formula
          ? c.label
            ? `Формула (${c.label})`
            : 'Формула'
          : c.label
            ? `${short} ${c.label}`
            : long,
        source,
        chapter: ci,
        block: blockIndex,
        page: page(),
      });
    };

    chapter.blocks.forEach((b) => {
      if (b.page) sourcePage = b.page;
      const bi = blocks.length;
      const sb: StreamBlock = { chapter: ci, source: b, start: items.length, end: 0 };
      blocks.push(sb);

      if (b.type === 'p' || b.type === 'h') {
        const tokens = tokenize(b.text);
        const mentions: { key: string; start: number; end: number }[] = [];
        if (b.type === 'p')
          for (const m of b.text.matchAll(MENTION))
            mentions.push({
              key: keyOf(mentionKind(m[1]), m[2]),
              start: m.index,
              end: m.index + m[0].length,
            });
        // Отложенные карточки ждут конца предложения, в котором на них сослались.
        const waiting: string[] = [];
        tokens.forEach((t, ti) => {
          const mention = mentions.find((m) => t.start < m.end && t.end > m.start);
          const parts = splitLong(t.text);
          const last = ti === tokens.length - 1;
          parts.forEach((part, pi) => {
            const tail = pi === parts.length - 1;
            let pause = tail ? punctuationPause(t.text) : 0;
            if (tail && last) pause += b.type === 'h' ? 1.5 : 1;
            items.push({
              kind: 'word',
              text: part,
              ctx: pi === 0 ? t.text : undefined,
              chapter: ci,
              block: bi,
              sentenceStart: pi === 0 && isSentenceStart(tokens[ti - 1]?.text, t.text),
              weight: wordWeight(part) * (b.type === 'h' ? 1.2 : 1),
              pause,
              page: page(),
              mention: mention?.key,
            });
          });
          words++;
          if (mention && deferred.has(mention.key) && !shown.has(mention.key)) {
            shown.add(mention.key);
            waiting.push(mention.key);
          }
          // Кончилось предложение со ссылкой — показываем. Точка в «рис.» концом не считается.
          const inside = mention && t.end < mention.end;
          if (waiting.length && !inside && (last || SENTENCE_END.test(t.text)))
            for (const key of waiting.splice(0)) pushCard(sourceBlockOf(key), placedAt.get(key)!);
        });
      } else if (isInlineCode(b)) {
        const text = (b as { text: string }).text.trim();
        items.push({
          kind: 'word',
          text,
          ctx: text,
          chapter: ci,
          block: bi,
          sentenceStart: true,
          weight: 1 + Math.min(2.5, text.length / 8),
          pause: 1,
          page: page(),
          mono: true,
        });
        words++;
      } else {
        const c = cardOf(b, book);
        const key = c?.label ? keyOf(keyType(c), c.label) : undefined;
        if (c && !(key && deferred.has(key))) pushCard(b, bi);
      }
      sb.end = items.length;
    });

    sc.end = items.length;
    chapters.push(sc);
  });

  // Карточки, отложенные до ссылки, знают номер исходного блока в главе;
  // переводим его в индекс `blocks`, чтобы текст на паузе показал картинку на своём месте.
  let offset = 0;
  book.chapters.forEach((chapter, ci) => {
    for (const idx of chapters[ci].cards) {
      const card = items[idx] as CardItem;
      card.block = offset + chapter.blocks.indexOf(card.source);
    }
    offset += chapter.blocks.length;
  });

  const cumWeight = new Float64Array(items.length + 1);
  const cumPause = new Float64Array(items.length + 1);
  items.forEach((it, i) => {
    cumWeight[i + 1] = cumWeight[i] + (it.kind === 'word' ? it.weight : 0);
    cumPause[i + 1] = cumPause[i] + (it.kind === 'word' ? it.pause : 0);
  });

  const lastPage = items.length ? items[items.length - 1].page : 1;
  const pageCount = book.pageMode === 'source' ? (book.pageLabels?.length ?? lastPage) : lastPage;
  return { book, items, blocks, chapters, pageCount, cumWeight, cumPause };
}

/** Подпись страницы: у PDF — как в книге («xii», «147»), иначе номер. */
export function pageLabel(s: Stream, page: number): string {
  return s.book.pageLabels?.[page - 1] ?? String(page);
}

/** Длительность показа элемента в мс. */
export function itemDelay(item: Item, wpm: number, pauseScale: number): number {
  if (item.kind !== 'word') return 0;
  return (60000 / wpm) * (item.weight + item.pause * pauseScale);
}

/** Сколько мс читать от `from` до `to` (без остановок на карточках). */
export function readingMs(s: Stream, from: number, to: number, wpm: number, pauseScale: number) {
  const w = s.cumWeight[to] - s.cumWeight[from];
  const p = s.cumPause[to] - s.cumPause[from];
  return ((w + p * pauseScale) * 60000) / wpm;
}

export function chapterAt(s: Stream, pos: number): number {
  const i = s.chapters.findIndex((c) => pos < c.end);
  return i < 0 ? s.chapters.length - 1 : i;
}

/** Начало предложения, в котором стоит `pos`. */
export function sentenceStartOf(s: Stream, pos: number): number {
  for (let i = pos; i >= 0; i--) {
    const it = s.items[i];
    if (it.kind !== 'word') return i + 1 <= pos ? i + 1 : pos;
    if (it.sentenceStart) return i;
  }
  return 0;
}

/** Начало абзаца (блока), в котором стоит `pos`. */
export function blockStartOf(s: Stream, pos: number): number {
  const it = s.items[pos];
  if (!it) return pos;
  for (let i = pos; i >= 0; i--) {
    const x = s.items[i];
    if (x.block !== it.block || x.kind !== 'word') return i + 1;
  }
  return 0;
}

/** Следующее (dir=1) или предыдущее (dir=-1) начало предложения. */
export function stepSentence(s: Stream, pos: number, dir: 1 | -1): number {
  if (dir < 0) {
    const cur = sentenceStartOf(s, pos);
    // Если уже стоим в начале предложения — к предыдущему.
    return cur < pos ? cur : sentenceStartOf(s, Math.max(0, cur - 1));
  }
  for (let i = pos + 1; i < s.items.length; i++) {
    const it = s.items[i];
    if (it.kind === 'card' || it.sentenceStart) return i;
  }
  return pos;
}
