import { describe, expect, it } from 'vitest';
import { buildStream, type CardItem } from '../engine/stream';
import { decode, parseFb2, parseTxt } from './import';

describe('parseTxt', () => {
  it('находит главы и абзацы', () => {
    const book = parseTxt(
      'Глава 1\n\nПервый абзац\nпродолжение.\n\nВторой абзац.\n\nГлава 2. Дорога\n\nТретий.',
      'Книга.txt',
    );
    expect(book.title).toBe('Книга');
    expect(book.chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2. Дорога']);
    expect(book.chapters[0].blocks).toEqual([
      { type: 'p', text: 'Первый абзац продолжение.' },
      { type: 'p', text: 'Второй абзац.' },
    ]);
  });

  it('читает windows-1251', () => {
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // «Привет»
    expect(decode(bytes)).toBe('Привет');
  });
});

describe('parseFb2', () => {
  const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description><title-info>
    <author><first-name>Анна</first-name><last-name>Иванова</last-name></author>
    <book-title>Сети</book-title>
    <coverpage><image l:href="#cover"/></coverpage>
  </title-info></description>
  <body>
    <section>
      <title><p>Часть первая</p></title>
      <section>
        <title><p>Глава 1</p></title>
        <p>Схема на рис. 1.1 показывает всё.</p>
        <p>Дальше текст.</p>
        <image l:href="#pic"/>
        <p>Рис. 1.1. Общая схема</p>
      </section>
      <section>
        <title><p>Глава 2</p></title>
        <p>Вторая глава.</p>
      </section>
    </section>
  </body>
  <binary id="pic" content-type="image/png">iVBORw0KGgo=</binary>
  <binary id="cover" content-type="image/jpeg">/9j/4AAQ</binary>
</FictionBook>`;

  it('разворачивает части в главы и забирает подпись рисунка', () => {
    const book = parseFb2(fb2);
    expect(book.title).toBe('Сети');
    expect(book.author).toBe('Анна Иванова');
    expect(book.cover).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(book.chapters.map((c) => c.title)).toEqual([
      'Часть первая. Глава 1',
      'Часть первая. Глава 2',
    ]);
    const fig = Object.values(book.figures)[0];
    expect(fig.label).toBe('1.1');
    expect(fig.caption).toBe('Общая схема');
    expect(fig.src).toBe('data:image/png;base64,iVBORw0KGgo=');
    // подпись не читается словами
    expect(book.chapters[0].blocks).toHaveLength(3);
  });

  it('ставит рисунок сразу после предложения со ссылкой', () => {
    const s = buildStream(parseFb2(fb2));
    const card = s.items.findIndex((i) => i.kind === 'card');
    expect((s.items[card] as CardItem).title).toBe('Рис. 1.1');
    expect(s.items[card - 1]).toMatchObject({ text: 'всё.' });
  });
});
