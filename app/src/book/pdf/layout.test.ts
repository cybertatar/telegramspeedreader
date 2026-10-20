import { describe, expect, it } from 'vitest';
import { layoutPdf } from './layout';
import type { Box, OutlineEntry, PdfData, PdfItem, PdfPage } from './types';

// Ширины букв обычного шрифта разные, моноширинного — одинаковые: по этому и узнаём код.
const width = (s: string, size: number, mono: boolean) =>
  mono
    ? s.length * size * 0.6
    : [...s].reduce(
        (w, c) => w + size * (/[iljtf.,]/.test(c) ? 0.28 : /[mwшщжМ]/.test(c) ? 0.8 : 0.52),
        0,
      );

function line(str: string, x: number, y: number, size = 10, font = 'serif'): PdfItem {
  return { str, x, y, w: width(str, size, font === 'mono'), size, font };
}

function page(index: number, items: PdfItem[], boxes: Box[] = []): PdfPage {
  return { index, width: 600, height: 800, label: String(index + 1), items, boxes };
}

const body = (y: number, text: string, x = 60) => line(text, x, y);

function book(pages: PdfPage[], outline: OutlineEntry[] = []): PdfData {
  return { pages, outline, fonts: { serif: { family: 'serif' }, mono: { family: 'sans-serif' } } };
}

// Колонтитул и номер страницы повторяются на каждой странице.
const chrome = (n: number) => [line('Сети для всех', 250, 30, 8), line(String(n), 295, 780, 8)];

describe('layoutPdf', () => {
  const pages = [
    page(0, [
      ...chrome(1),
      line('Глава 1. Пакеты', 60, 100, 18),
      body(140, 'Данные в сети передаются небольшими кусками, кото-'),
      body(153, 'рые называются пакетами. Это основа всего.'),
      body(175, 'Каждый пакет идёт своим путём, а получатель'),
      body(188, 'собирает их обратно в нужном порядке.'),
      line('$ ping example.com', 70, 215, 10, 'mono'),
      line('64 bytes from example.com', 70, 228, 10, 'mono'),
      line('time=11.2 ms', 94, 241, 10, 'mono'),
      body(255, 'Формула пропускной способности такая:'),
      line('C = B log(1 + S/N)', 220, 280),
      line('(1)', 520, 280),
      body(305, 'Здесь B — ширина полосы. Подробнее в разделе ниже.'),
      line('1 Это сноска внизу страницы.', 60, 740, 7),
    ]),
    page(
      1,
      [
        ...chrome(2),
        body(100, 'Продолжение: маршрутизатор читает адрес и отправляет'),
        body(113, 'пакет дальше.'),
        line('Рис. 1.1. Путь пакета', 200, 420),
        body(450, 'Конец главы.'),
        ...Array.from({ length: 10 }, (_, i) =>
          body(470 + i * 13, `Строка номер ${i} обычного текста главы.`),
        ),
      ],
      [
        // Схема из десятка линий и прямоугольников.
        ...Array.from({ length: 10 }, (_, i) => ({
          kind: 'path' as const,
          x0: 150 + i * 30,
          x1: 175 + i * 30,
          top: 150,
          bottom: 400,
        })),
      ],
    ),
    page(2, [...chrome(3), line('Глава 2. Итоги', 60, 100, 18), body(140, 'Всё.')]),
  ];
  const outline: OutlineEntry[] = [
    { title: 'Глава 1. Пакеты', level: 1, page: 0, y: 76 },
    { title: 'Глава 2. Итоги', level: 1, page: 2, y: 76 },
  ];
  const L = layoutPdf(book(pages, outline), 'Сети');
  const ch1 = L.chapters[0];
  const texts = ch1.blocks.map((b) => ('text' in b ? b.text : `[${b.type}]`));

  it('делит на главы по закладкам и не читает заголовок главы второй раз', () => {
    expect(L.chapters.map((c) => c.title)).toEqual(['Глава 1. Пакеты', 'Глава 2. Итоги']);
    expect(texts[0]).toMatch(/^Данные/);
  });

  it('убирает колонтитулы, номера страниц и сноски', () => {
    const all = texts.join(' ');
    expect(all).not.toMatch(/Сети для всех|сноска/);
  });

  it('склеивает переносы и строки абзаца', () => {
    expect(texts[0]).toBe(
      'Данные в сети передаются небольшими кусками, которые называются пакетами. Это основа всего.',
    );
    expect(texts[1]).toBe(
      'Каждый пакет идёт своим путём, а получатель собирает их обратно в нужном порядке.',
    );
  });

  it('собирает код по моноширинному шрифту с отступами', () => {
    const code = ch1.blocks.find((b) => b.type === 'code');
    expect(code).toMatchObject({
      text: '$ ping example.com\n64 bytes from example.com\n    time=11.2 ms',
    });
  });

  it('вырезает выключную формулу с номером картинкой', () => {
    const f = Object.values(L.figures).find((x) => x.kind === 'formula');
    expect(f?.label).toBe('1');
    expect(texts.join(' ')).not.toMatch(/log\(1/);
  });

  it('продолжает абзац на следующей странице', () => {
    expect(texts).toContain('Здесь B — ширина полосы. Подробнее в разделе ниже.');
    expect(texts).toContain('Продолжение: маршрутизатор читает адрес и отправляет пакет дальше.');
  });

  it('находит схему из линий и оставляет подпись следом за ней', () => {
    const fi = ch1.blocks.findIndex(
      (b) => b.type === 'figure' && L.figures[b.id].kind === 'figure',
    );
    expect(fi).toBeGreaterThan(-1);
    expect(ch1.blocks[fi + 1]).toMatchObject({ text: 'Рис. 1.1. Путь пакета' });
    expect(L.crops[(ch1.blocks[fi] as { id: string }).id]).toMatchObject({ page: 1 });
  });

  it('сохраняет подписи страниц', () => {
    expect(L.pageLabels).toEqual(['1', '2', '3']);
    expect(ch1.blocks[0].page).toBe(1);
  });
});
