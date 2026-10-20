// Подписи «Рис. 3.2. Схема…», «Таблица 1: …», «Листинг 4 — …» рядом с иллюстрацией,
// таблицей или кодом: забираем номер и текст в саму карточку, чтобы ссылки
// «см. рис. 3.2» на неё работали, а подпись не читалась словами второй раз.

import type { Block, Book } from './types';

const FIGURE = /^(рис(?:унок)?\.?|илл\.?|fig(?:ure)?\.?)\s*(\d+(?:\.\d+)*)[.:]?\s*(.*)$/iu;
const TABLE = /^(табл(?:ица)?\.?|table)\s*(\d+(?:\.\d+)*)[.:]?\s*(.*)$/iu;
const LISTING = /^(листинг|listing)\s*(\d+(?:\.\d+)*)[.:]?\s*(.*)$/iu;

const strip = (s: string) => s.replace(/^[—–-]\s*/, '').trim();

export function attachCaptions(book: Book) {
  for (const ch of book.chapters) {
    const drop = new Set<Block>();
    ch.blocks.forEach((b, i) => {
      const prev = ch.blocks[i - 1];
      const next = ch.blocks[i + 1];
      const text = (x: Block | undefined) => (x?.type === 'p' && !drop.has(x) ? x.text : '');
      if (b.type === 'figure') {
        const fig = book.figures[b.id];
        if (!fig || fig.kind === 'formula') return;
        // У рисунка подпись обычно ниже, у таблицы — выше; PDF-таблицы тоже вырезаны картинкой.
        const candidates: [Block | undefined, RegExp, 'figure' | 'table'][] = [
          [next, FIGURE, 'figure'],
          [prev, TABLE, 'table'],
          [next, TABLE, 'table'],
          [prev, FIGURE, 'figure'],
        ];
        for (const [blk, re, kind] of candidates) {
          const m = text(blk).match(re);
          if (!m) continue;
          fig.label = m[2];
          fig.caption = strip(m[3]) || fig.caption;
          fig.kind = kind;
          drop.add(blk!);
          return;
        }
      } else if (b.type === 'code' || b.type === 'table') {
        const re = b.type === 'code' ? LISTING : TABLE;
        for (const blk of [prev, next]) {
          const m = text(blk).match(re);
          if (!m) continue;
          b.label = m[2];
          b.caption = strip(m[3]) || b.caption;
          drop.add(blk!);
          return;
        }
      }
    });
    if (drop.size) ch.blocks = ch.blocks.filter((b) => !drop.has(b));
  }
}
