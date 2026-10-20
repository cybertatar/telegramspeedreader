// Раскладка PDF в главы и блоки: строки из кусочков текста, порядок колонок,
// колонтитулы, абзацы с переносами, код, рисунки, таблицы и формулы картинками.
// Только чистые функции — проверяются в Node на настоящих книгах.

import type { Block, Chapter, Figure } from '../types';
import type { Box, Crop, PdfData, PdfItem, PdfPage } from './types';

export interface PdfLayout {
  chapters: Chapter[];
  figures: Record<string, Figure>;
  /** Что вырезать картинками: id рисунка → участок страницы. */
  crops: Record<string, Crop>;
  pageLabels: string[];
  /** Сколько страниц без текста — вероятно, скан, нужен OCR. */
  emptyPages: number;
}

interface Line {
  page: number;
  items: PdfItem[];
  x0: number;
  x1: number;
  /** Базовая линия. */
  y: number;
  size: number;
  text: string;
  mono: boolean;
  /** Строка начинается с моноширинного кусочка (комментарий в коде набран другим шрифтом). */
  monoStart: boolean;
  /** Ширина символа моноширинного шрифта — для отступов в коде. */
  charW: number;
}

type Element =
  | { kind: 'line'; line: Line; col: Col; top: number }
  | { kind: 'region'; region: Region; col: Col; top: number };

type Col = 'L' | 'R' | 'F';

interface Region {
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  type: 'figure' | 'table' | 'formula';
  /** Номер формулы «(3)» — для ссылок «Eqn. (3)». */
  label?: string;
}

const MATH = /[=+−×÷·∑∏∫√∂∇≤≥≈≠∈∉⊂⊆∪∩∞→←↔⇒⇔^_|∀∃∝⊕⊗α-ωΑ-Ω]/u;
const SENTENCE_END = /[.!?…:;»"”)]$/u;
const BULLET = /^([•▪◦‣●○■□➢►✓-]\s|[–—]\s|\d{1,2}[.)]\s|[a-zа-я][.)]\s)/u;
/** Нумерованный заголовок раздела: «3.2 Identity Mapping», «2. Related Work», «Глава 4 …». */
const SECTION_KEYWORD =
  /^(abstract|аннотация|references|список литературы|литература|acknowledg(e)?ments|благодарности|appendix|приложение)$/iu;
const SECTION_NUMBER = /^(\d+(\.\d+){0,3}\.?|[A-Z]\.)\s+\p{Lu}/u;
const SECTION_WORD = /^(глава|часть|chapter|part)\s+\d+/iu;
/** Нумерованный заголовок раздела: «3.2 Identity Mapping», «2. Related Work», «Глава 4 …». */
const isSection = (t: string) =>
  SECTION_NUMBER.test(t) || SECTION_WORD.test(t) || SECTION_KEYWORD.test(t);
/** Заголовок раздела верхнего уровня — для глав, когда у PDF нет закладок. */
const isTopSection = (t: string) =>
  /^(\d+\.?|[A-Z]\.)\s+\p{Lu}/u.test(t) || SECTION_WORD.test(t) || SECTION_KEYWORD.test(t);
const CAPTION = /^(рис(унок)?|fig(ure)?|табл(ица)?|table|листинг|listing)\.?\s*\d/iu;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Размер основного текста и моноширинные шрифты (по одинаковой ширине всех символов). */
function analyzeFonts(data: PdfData) {
  const sizeChars = new Map<number, number>();
  const ratios = new Map<string, number[]>();
  for (const p of data.pages)
    for (const it of p.items) {
      const len = it.str.replace(/\s/g, '').length;
      if (!len) continue;
      const s = Math.round(it.size * 2) / 2;
      sizeChars.set(s, (sizeChars.get(s) ?? 0) + len);
      if (it.str.length >= 2) {
        const r = ratios.get(it.font) ?? [];
        if (r.length < 400) r.push(it.w / (it.str.length * it.size));
        ratios.set(it.font, r);
      }
    }
  let body = 10;
  let best = 0;
  for (const [s, n] of sizeChars) if (n > best) [best, body] = [n, s];
  const mono = new Map<string, number>();
  for (const [font, r] of ratios) {
    const m = median(r);
    const family = data.fonts[font]?.family;
    const steady =
      r.length >= 3 && r.filter((x) => Math.abs(x - m) / m < 0.02).length / r.length > 0.95;
    if (family === 'monospace' || (steady && m > 0.4 && m < 0.7)) mono.set(font, m);
  }
  return { body, mono };
}

function lineText(items: PdfItem[], size: number) {
  let text = '';
  let prev: PdfItem | null = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > 0.15 * size && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
    }
    text += it.str;
    prev = it;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Кусочки текста → строки. */
function buildLines(page: PdfPage, mono: Map<string, number>): Line[] {
  const items = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    // Индексы (W₂, x²) сидят ниже или выше строки, но к ней относятся.
    if (row && Math.abs(it.y - row[0].y) <= 0.45 * Math.max(it.size, row[0].size)) row.push(it);
    else rows.push([it]);
  }
  const lines: Line[] = [];
  const mainSize = (items: PdfItem[]) => {
    const bySize = new Map<number, number>();
    for (const it of items) bySize.set(it.size, (bySize.get(it.size) ?? 0) + it.str.length);
    return [...bySize].sort((a, b) => b[1] - a[1])[0][0];
  };
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // Большой разрыв по горизонтали делит строку: соседние колонки, ячейки.
    const parts: PdfItem[][] = [];
    for (const it of row) {
      const part = parts[parts.length - 1];
      const prev = part?.[part.length - 1];
      if (prev && it.x - (prev.x + prev.w) <= Math.max(1.5 * Math.max(it.size, prev.size), 12))
        part.push(it);
      else parts.push([it]);
    }
    for (const raw of parts) {
      const size = mainSize(raw);
      const base = (raw.find((it) => it.size === size) ?? raw[0]).y;
      // Сноски-индексы над строкой (мелкие и приподнятые) из текста убираем.
      const part = raw.filter(
        (it) =>
          !(it.size < 0.8 * size && base - it.y > 0.15 * size && /^[\d*†‡,]+$/.test(it.str.trim())),
      );
      if (!part.length) continue;
      const text = lineText(part, size);
      if (!text) continue;
      const nonSpace = part.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0);
      const monoChars = part.reduce(
        (n, it) => n + (mono.has(it.font) ? it.str.replace(/\s/g, '').length : 0),
        0,
      );
      const monoFont = part.find((it) => mono.has(it.font));
      lines.push({
        page: page.index,
        items: part,
        x0: part[0].x,
        x1: Math.max(...part.map((it) => it.x + it.w)),
        y: base,
        size,
        text,
        mono: nonSpace > 0 && monoChars / nonSpace >= 0.9,
        monoStart: mono.has(part.find((it) => it.str.trim())?.font ?? ''),
        charW: monoFont ? mono.get(monoFont.font)! * monoFont.size : size * 0.6,
      });
    }
  }
  lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  return lines;
}

/** Колонтитулы и номера страниц: строки у края страницы, повторяющиеся на многих страницах. */
function findRunningLines(lines: Line[][], pages: PdfPage[]) {
  const key = (l: Line) =>
    l.text
      .toLowerCase()
      .replace(/\d+/g, '#')
      .replace(/\b[ivxlc]+\b/g, '#')
      .trim();
  const edge = (l: Line) => {
    const h = pages[l.page].height;
    return l.y - l.size < 0.09 * h || l.y > 0.91 * h;
  };
  const count = new Map<string, number>();
  lines.forEach((ls) => {
    const seen = new Set<string>();
    for (const l of ls) if (edge(l)) seen.add(key(l));
    for (const k of seen) count.set(k, (count.get(k) ?? 0) + 1);
  });
  const limit = Math.max(3, pages.length * 0.12);
  const running = new Set<Line>();
  for (const ls of lines)
    for (const l of ls) {
      if (!edge(l)) continue;
      const k = key(l);
      if (/^[#\s.,–—-]*$/.test(k) || (count.get(k) ?? 0) >= limit) running.add(l);
    }
  return running;
}

const area = (b: { x0: number; x1: number; top: number; bottom: number }) =>
  Math.max(0, b.x1 - b.x0) * Math.max(0, b.bottom - b.top);

const overlaps = (
  a: { x0: number; x1: number; top: number; bottom: number },
  b: { x0: number; x1: number; top: number; bottom: number },
  pad = 0,
) => a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.top - pad < b.bottom && b.top - pad < a.bottom;

/**
 * Рисунки и таблицы по графике страницы: картинки, скопления векторных линий
 * (схемы, таблицы с рамками), а также таблицы из трёх и более горизонтальных линеек.
 */
function findRegions(page: PdfPage, lines: Line[]): Region[] {
  const pageArea = page.width * page.height;
  const boxes = page.boxes.filter(
    (b) =>
      area(b) < 0.85 * pageArea &&
      b.x1 > 0 &&
      b.x0 < page.width &&
      b.bottom > 0 &&
      b.top < page.height,
  );
  // Склеиваем соседние фигуры в скопления.
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlaps(boxes[i], boxes[j], 6)) parent[find(i)] = find(j);
  const clusters = new Map<number, Box[]>();
  boxes.forEach((b, i) => {
    const r = find(i);
    clusters.set(r, [...(clusters.get(r) ?? []), b]);
  });

  const regions: Region[] = [];
  for (const group of clusters.values()) {
    const r = {
      page: page.index,
      x0: Math.min(...group.map((b) => b.x0)),
      x1: Math.max(...group.map((b) => b.x1)),
      top: Math.min(...group.map((b) => b.top)),
      bottom: Math.max(...group.map((b) => b.bottom)),
      type: 'figure' as const,
    };
    const images = group.filter((b) => b.kind === 'image' && area(b) > 400);
    const paths = group.filter((b) => b.kind === 'path');
    const w = r.x1 - r.x0;
    const h = r.bottom - r.top;
    // Узкие высокие схемы (столбики слоёв сети) тоже рисунки.
    const big =
      area(r) > 0.008 * pageArea && h > 30 && (w > 0.08 * page.width || h > 0.2 * page.height);
    if (images.length && big) regions.push(r);
    else if (paths.length >= 8 && big) {
      // Фон блока кода или врезки — один-два прямоугольника — сюда не попадает (мало фигур).
      // Но рамки вокруг кода из многих отрезков — попадают: проверяем, что внутри не код.
      const inside = lines.filter(
        (l) => l.y > r.top && l.y < r.bottom && l.x0 >= r.x0 - 2 && l.x1 <= r.x1 + 2,
      );
      const code = inside.filter((l) => l.mono).length;
      if (!(paths.length < 30 && inside.length && code / inside.length > 0.6)) regions.push(r);
    }
  }

  // Таблицы «в три линейки» (как в статьях): горизонтальные линии одной ширины.
  const rules = page.boxes
    .filter((b) => b.kind === 'path' && b.bottom - b.top < 2 && b.x1 - b.x0 > 0.2 * page.width)
    .sort((a, b) => a.top - b.top);
  const used = new Set<Box>();
  for (const a of rules) {
    if (used.has(a)) continue;
    const same = rules.filter(
      (b) =>
        !used.has(b) &&
        Math.abs(b.x0 - a.x0) < 4 &&
        Math.abs(b.x1 - a.x1) < 4 &&
        b.top >= a.top &&
        b.top - a.top < 0.5 * page.height,
    );
    if (same.length < 3) continue;
    same.forEach((b) => used.add(b));
    const r: Region = {
      page: page.index,
      x0: a.x0,
      x1: a.x1,
      top: a.top,
      bottom: same[same.length - 1].bottom,
      type: 'table',
    };
    // Между линейками должен быть текст, иначе это просто оформление.
    if (lines.some((l) => l.y > r.top && l.y < r.bottom)) regions.push(r);
  }

  // Подписи на схеме (текст рядом с линиями и поверх них) — часть рисунка: расширяем область.
  for (const r of regions) {
    for (const l of lines) {
      const box = { x0: l.x0, x1: l.x1, top: l.y - l.size, bottom: l.y + 0.3 * l.size };
      if (!overlaps(box, r, 10) || CAPTION.test(l.text) || l.x1 - l.x0 > 0.5 * page.width) continue;
      r.x0 = Math.min(r.x0, box.x0);
      r.x1 = Math.max(r.x1, box.x1);
      r.top = Math.min(r.top, box.top);
      r.bottom = Math.max(r.bottom, box.bottom);
    }
  }

  // Пересекающиеся области сливаем.
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < regions.length; i++)
      for (let j = i + 1; j < regions.length; j++)
        // Части одного рисунка (колонки схемы) стоят рядом — сливаем с запасом.
        if (overlaps(regions[i], regions[j], 28)) {
          const a = regions[i];
          const b = regions[j];
          regions[i] = {
            ...a,
            x0: Math.min(a.x0, b.x0),
            x1: Math.max(a.x1, b.x1),
            top: Math.min(a.top, b.top),
            bottom: Math.max(a.bottom, b.bottom),
            type: a.type === 'table' || b.type === 'table' ? 'table' : 'figure',
          };
          regions.splice(j, 1);
          changed = true;
          break outer;
        }
  }
  return regions;
}

const mathShare = (text: string) => {
  const chars = [...text.replace(/\s/g, '')];
  return chars.length ? chars.filter((c) => MATH.test(c)).length / chars.length : 0;
};

/** Формулы: строки, где много математических знаков, или короткие строки по центру с «=». */
function isFormula(l: Line, colX0: number, colX1: number) {
  if (l.mono || l.text.length < 3) return false;
  const share = mathShare(l.text);
  if (share >= 0.3) return true;
  const words = l.text.split(/\s+/).filter((w) => /^\p{L}{4,}$/u.test(w)).length;
  // Номер формулы справа: «y = F(x) + x. (1)».
  if (/\(\d+(\.\d+)?\)$/.test(l.text) && /[=≤≥≈]/.test(l.text) && words <= 1) return true;
  const center = (l.x0 + l.x1) / 2;
  const centered = Math.abs(center - (colX0 + colX1) / 2) < 0.12 * (colX1 - colX0);
  const short = l.x1 - l.x0 < 0.75 * (colX1 - colX0);
  // Выключная формула: отступ от края колонки, «=», почти нет обычных слов.
  const indented = l.x0 - colX0 > 2 * l.size;
  if (indented && short && /[=≤≥≈]/.test(l.text) && words <= 1) return true;
  return centered && short && /[=≤≥≈]/.test(l.text) && share >= 0.08 && words <= 2;
}

/** Обрывок формулы: короткая строка без двух обычных слов подряд («(pos,2i)», «K», «V , W i ∈ R»). */
function isFragment(l: Line) {
  if (l.mono || l.text.length > 45) return false;
  const words = l.text.split(/\s+/);
  for (let i = 1; i < words.length; i++)
    if (/^\p{L}{3,}[,.;:]?$/u.test(words[i - 1]) && /^\p{L}{3,}[,.;:]?$/u.test(words[i]))
      return false;
  return !/^\p{Lu}\p{Ll}{3,}/u.test(l.text) || words.length === 1;
}

/** Порядок чтения: в двухколоночной странице сначала левая колонка, потом правая. */
function readingOrder(page: PdfPage, lines: Line[], regions: Region[]): Element[] {
  const mid = page.width / 2;
  const side = (x0: number, x1: number): Col =>
    x1 < mid + 0.03 * page.width ? 'L' : x0 > mid - 0.03 * page.width ? 'R' : 'F';
  const els: Element[] = [
    ...lines.map((line) => ({
      kind: 'line' as const,
      line,
      col: side(line.x0, line.x1),
      top: line.y - line.size,
    })),
    ...regions.map((region) => ({
      kind: 'region' as const,
      region,
      col: side(region.x0, region.x1),
      top: region.top,
    })),
  ];
  // Две колонки — когда слева и справа много длинных строк, а во всю ширину почти нет.
  const long = (e: Element, col: Col) =>
    e.kind === 'line' && e.col === col && e.line.x1 - e.line.x0 > 0.25 * page.width;
  const left = els.filter((e) => long(e, 'L')).length;
  const right = els.filter((e) => long(e, 'R')).length;
  const wide = els.filter(
    (e) => e.kind === 'line' && e.line.x1 - e.line.x0 > 0.6 * page.width,
  ).length;
  if (left < 6 || right < 6 || wide > Math.max(3, 0.2 * (left + right))) {
    els.sort((a, b) => a.top - b.top || x0(a) - x0(b));
    return els.map((e) => ({ ...e, col: 'F' as Col }));
  }
  // Полосы между элементами во всю ширину; внутри полосы — левая, затем правая колонка.
  els.sort((a, b) => a.top - b.top);
  const out: Element[] = [];
  let band: Element[] = [];
  const flush = () => {
    out.push(...band.filter((e) => e.col === 'L'), ...band.filter((e) => e.col === 'R'));
    band = [];
  };
  for (const e of els) {
    if (e.col === 'F') {
      flush();
      out.push(e);
    } else band.push(e);
  }
  flush();
  return out;
}

const x0 = (e: Element) => (e.kind === 'line' ? e.line.x0 : e.region.x0);

const KEEP_HYPHEN = /^(то|либо|нибудь|ка|таки|де|с)(\P{L}|$)/u;

function joinLines(a: string, b: string) {
  if (/[\p{L}\p{N}][-‐]$/u.test(a) && /^\p{L}/u.test(b)) {
    const before = a.slice(-2, -1);
    const sameScript = /\p{Script=Cyrillic}/u.test(before) === /\p{Script=Cyrillic}/u.test(b[0]);
    // Перенос по слогам: «соеди-» + «нение» → «соединение». Но «кто-» + «нибудь»,
    // «Git-» + «репозиторий» и «Attribution-» + «NonCommercial» — слово с дефисом.
    if (sameScript && /\p{Ll}/u.test(before) && /^\p{Ll}/u.test(b) && !KEEP_HYPHEN.test(b))
      return a.slice(0, -1) + b;
    return a + b;
  }
  return a + ' ' + b;
}

function codeText(lines: Line[]) {
  const charW = lines[0].charW || lines[0].size * 0.6;
  const minX = Math.min(...lines.map((l) => l.x0));
  return lines
    .map((l) => {
      let s = '';
      for (const it of l.items) {
        const col = Math.round((it.x - minX) / charW);
        if (col > s.length) s += ' '.repeat(col - s.length);
        s += it.str;
      }
      return s.trimEnd();
    })
    .join('\n');
}

const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function layoutPdf(data: PdfData, fallbackTitle: string): PdfLayout {
  const { body, mono } = analyzeFonts(data);
  const pageLines = data.pages.map((p) => buildLines(p, mono));
  const running = findRunningLines(pageLines, data.pages);

  // Обычный шаг между строками основного текста — чтобы отличать новый абзац.
  const steps: number[] = [];
  pageLines.forEach((ls) => {
    // Шаг считаем между строками одной колонки: ближайшая строка ниже с тем же левым краем.
    for (const a of ls) {
      if (Math.abs(a.size - body) > 0.6) continue;
      const b = ls.find((x) => x.y > a.y + 0.5 * a.size && Math.abs(x.x0 - a.x0) < 2 * a.size);
      if (b && Math.abs(b.size - body) < 0.6) steps.push(b.y - a.y);
    }
  });
  const step = median(steps) || body * 1.3;

  interface Pos {
    page: number;
    top: number;
  }
  const out: { block: Block; pos: Pos }[] = [];
  const figures: Record<string, Figure> = {};
  const crops: Record<string, Crop> = {};
  let emptyPages = 0;

  /** `into` — абзац, который продолжаем после рисунка: дописываем в уже выданный блок. */
  let para: { text: string; last: Line; col: Col; pos: Pos; into?: { text: string } } | null = null;
  let code: { lines: Line[]; pos: Pos } | null = null;
  let heading: { text: string; last: Line; pos: Pos } | null = null;
  // Абзац, оборванный рисунком или подписью: его продолжение ищем после них.
  let dangling: { type: 'p'; text: string } | null = null;
  const flush = () => {
    if (para) {
      // Маркер списка словами не показываем; нумерацию «1.» оставляем.
      const text = para.text.replace(/^[•▪◦‣●○■□➢►✓]\s*/u, '');
      let block = para.into as { type: 'p'; text: string } | undefined;
      if (block) block.text = text;
      else {
        block = { type: 'p', text, page: para.pos.page + 1 } as { type: 'p'; text: string };
        out.push({ block, pos: para.pos });
      }
      if (!CAPTION.test(text)) dangling = SENTENCE_END.test(text) ? null : block;
    }
    if (code || heading) dangling = null;
    if (code) {
      // Адреса почты и ссылки моноширинным шрифтом — это текст, а не листинг.
      const plain = code.lines.every((l) => /^\S+@\S+$|^(https?:\/\/|www\.)\S+$/.test(l.text));
      const block: Block = plain
        ? { type: 'p', text: code.lines.map((l) => l.text).join(' '), page: code.pos.page + 1 }
        : { type: 'code', text: codeText(code.lines), page: code.pos.page + 1 };
      out.push({ block, pos: code.pos });
    }
    if (heading)
      out.push({
        block: { type: 'h', text: heading.text, page: heading.pos.page + 1 },
        pos: heading.pos,
      });
    para = code = heading = null;
  };
  const addCrop = (r: Region) => {
    const id = `p${r.page + 1}-${Object.keys(figures).length + 1}`;
    figures[id] = { id, src: '', kind: r.type, label: r.label };
    const pad = r.type === 'formula' ? 3 : 4;
    const pg = data.pages[r.page];
    crops[id] = {
      page: r.page,
      x0: Math.max(0, r.x0 - pad),
      x1: Math.min(pg.width, r.x1 + pad),
      top: Math.max(0, r.top - pad),
      bottom: Math.min(pg.height, r.bottom + pad),
    };
    out.push({
      block: { type: 'figure', id, page: r.page + 1 },
      pos: { page: r.page, top: r.top },
    });
  };

  data.pages.forEach((page, pi) => {
    const lines = pageLines[pi].filter((l) => !running.has(l));
    if (!lines.length) emptyPages++;
    const regions = findRegions(page, lines);
    // Текст внутри рисунка (подписи осей, ячейки таблиц) в поток не идёт.
    const inRegion = (l: Line) =>
      regions.some(
        (r) =>
          l.y - l.size * 0.3 > r.top - 2 &&
          l.y < r.bottom + 2 &&
          l.x0 >= r.x0 - 4 &&
          l.x1 <= r.x1 + 4,
      );
    const flow = lines.filter((l) => !inRegion(l));

    // Границы колонки для отступов и формул.
    const bodyLines = flow.filter((l) => Math.abs(l.size - body) < 0.6 && !l.mono);
    const colLeft = median(bodyLines.map((l) => l.x0)) || 0;
    const colRight = Math.max(...bodyLines.map((l) => l.x1), colLeft + 100);
    const twoCol = readingOrder(page, flow, []).some((e) => e.col !== 'F');
    const colBounds = (col: Col) => {
      const ls = bodyLines.filter((l) =>
        twoCol ? (col === 'L' ? l.x1 < page.width / 2 + 20 : l.x0 > page.width / 2 - 20) : true,
      );
      return {
        left: median(ls.map((l) => l.x0)) || colLeft,
        right: ls.length ? Math.max(...ls.map((l) => l.x1)) : colRight,
      };
    };

    // Формулы: подряд идущие «математические» строки — одна вырезка.
    const formulaLines = new Set<Line>();
    for (const l of flow) {
      const c = colBounds(twoCol && l.x1 < page.width / 2 + 20 ? 'L' : twoCol ? 'R' : 'F');
      if (isFormula(l, c.left, c.right)) formulaLines.add(l);
    }
    // Обрывки с математикой — тоже формулы; и обрывки вплотную к формуле — её части.
    for (const l of flow)
      if (isFragment(l) && /[=≤≥≈∝]/.test(l.text) && l.x1 - l.x0 > 60 && !CAPTION.test(l.text))
        formulaLines.add(l);
    for (let grown = true; grown;) {
      grown = false;
      for (const l of flow) {
        if (formulaLines.has(l) || !isFragment(l) || CAPTION.test(l.text)) continue;
        const near = [...formulaLines].some(
          (f) => Math.abs(f.y - l.y) < step * 1.3 && l.x0 < f.x1 + 20 && f.x0 < l.x1 + 20,
        );
        if (near) {
          formulaLines.add(l);
          grown = true;
        }
      }
    }
    // Номер формулы «(3)» на той же высоте — часть формулы.
    for (const l of flow)
      if (
        /^\(\d+(\.\d+)?\)$/.test(l.text) &&
        [...formulaLines].some((f) => Math.abs(f.y - l.y) < 3)
      )
        formulaLines.add(l);
    const formulaRegions: Region[] = [];
    // Номер формулы стоит далеко справа — сразу пристёгиваем его к строке формулы.
    const eqNumber = (l: Line) => /^\(\d+(\.\d+)?\)$/.test(l.text);
    const numbered = new Set<Line>();
    for (const n of [...formulaLines].filter(eqNumber)) {
      const f = [...formulaLines].find((x) => !eqNumber(x) && Math.abs(x.y - n.y) < 3);
      if (!f) continue;
      formulaRegions.push({
        page: pi,
        x0: Math.min(f.x0, n.x0),
        x1: Math.max(f.x1, n.x1),
        top: f.y - f.size * 1.05,
        bottom: f.y + f.size * 0.4,
        type: 'formula',
        label: n.text.slice(1, -1),
      });
      numbered.add(f).add(n);
    }
    for (const l of formulaLines) {
      if (numbered.has(l)) continue;
      formulaRegions.push({
        page: pi,
        x0: l.x0,
        x1: l.x1,
        top: l.y - l.size * 1.05,
        bottom: l.y + l.size * 0.4,
        type: 'formula',
      });
    }
    // Куски одной формулы (числитель, знаменатель, индексы) сливаем в одну вырезку.
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < formulaRegions.length; i++)
        for (let j = i + 1; j < formulaRegions.length; j++) {
          const a = formulaRegions[i];
          const b = formulaRegions[j];
          const near =
            a.x0 < b.x1 + 30 &&
            b.x0 < a.x1 + 30 &&
            a.top < b.bottom + step * 0.6 &&
            b.top < a.bottom + step * 0.6;
          if (!near) continue;
          formulaRegions[i] = {
            ...a,
            x0: Math.min(a.x0, b.x0),
            x1: Math.max(a.x1, b.x1),
            top: Math.min(a.top, b.top),
            bottom: Math.max(a.bottom, b.bottom),
          };
          formulaRegions.splice(j, 1);
          merged = true;
          break outer;
        }
    }
    for (const r of formulaRegions)
      for (const l of formulaLines)
        if (!r.label && l.y > r.top && l.y < r.bottom + 1) {
          const m = l.text.match(/\((\d+(?:\.\d+)?)\)$/);
          if (m) r.label = m[1];
        }
    // Строки, целиком попавшие в слитую формулу, — тоже её часть.
    for (const l of flow)
      if (
        formulaRegions.some(
          (r) => l.y > r.top && l.y < r.bottom && l.x0 >= r.x0 - 2 && l.x1 <= r.x1 + 2,
        )
      )
        formulaLines.add(l);

    const order = readingOrder(
      page,
      flow.filter((l) => !formulaLines.has(l)),
      [...regions, ...formulaRegions],
    );

    let prevCol: Col | null = null;
    for (const el of order) {
      if (el.kind === 'region') {
        flush();
        addCrop(el.region);
        prevCol = el.col;
        continue;
      }
      const l = el.line;
      const pos = { page: pi, top: el.top };
      // Строки оглавления с отточием: «Глава 2 ........ 37».
      if (/(\.\s?){4,}\s*\S{1,8}$/.test(l.text)) continue;

      // Мелкий текст внизу страницы — сноски: в поток не берём.
      if (l.size <= body * 0.85 && l.y > page.height * 0.7 && !CAPTION.test(l.text)) continue;

      // Комментарии в коде часто набраны обычным шрифтом (в моноширинном нет кириллицы):
      // такая строка начинается с моноширинного «#» или «//» и сдвинута, как код.
      const { left, right } = colBounds(el.col);
      const codeLike = l.mono || (l.monoStart && (l.x0 - left > 0.5 * l.size || code !== null));
      if (codeLike) {
        if (!code) {
          flush();
          code = { lines: [], pos };
        } else {
          const prev = code.lines[code.lines.length - 1];
          if (prev.page === l.page && l.y - prev.y > step * 3) {
            flush();
            code = { lines: [], pos };
          }
        }
        code.lines.push(l);
        prevCol = el.col;
        continue;
      }

      const numbered =
        isSection(l.text) &&
        l.size >= body - 0.5 &&
        l.text.length < 90 &&
        !/[.,;:]$/.test(l.text) &&
        l.x1 - l.x0 < 0.7 * (right - left);
      const isHeading =
        (l.size >= body * 1.15 && l.text.length <= 150 && /\p{L}/u.test(l.text)) || numbered;
      if (isHeading) {
        const joinHeading =
          heading &&
          !isSection(l.text) &&
          heading.last.page === l.page &&
          l.y - heading.last.y < l.size * 1.8 &&
          Math.abs(heading.last.size - l.size) < 1;
        if (joinHeading && heading) {
          heading.text += ' ' + l.text;
          heading.last = l;
        } else {
          flush();
          heading = { text: l.text, last: l, pos };
        }
        prevCol = el.col;
        continue;
      }

      let newPara = !para || CAPTION.test(l.text) || BULLET.test(l.text);
      if (para && !newPara) {
        const last: Line = para.last;
        const samePlace = last.page === l.page && prevCol === el.col;
        const shortPrev = last.x1 < right - 3 * last.size && SENTENCE_END.test(para.text);
        if (samePlace) {
          const gap = l.y - last.y;
          if (gap > step * 1.45 || gap < 0) newPara = true;
        } else if (shortPrev || (SENTENCE_END.test(para.text) && /^\p{Lu}/u.test(l.text)))
          // На новой странице или в новой колонке: абзац кончился, если строка с заглавной.
          newPara = true;
        // Красная строка: строка сдвинута вправо относительно предыдущей. У пунктов списка
        // продолжение и так сдвинуто под текст пункта — там не считаем.
        if (
          samePlace &&
          !BULLET.test(para.text) &&
          l.x0 - last.x0 > 0.8 * l.size &&
          l.x0 - left < 8 * l.size
        )
          newPara = true;
        if (shortPrev && samePlace) newPara = true;
        if (CAPTION.test(para.text) && samePlace && l.y - last.y > step * 1.2) newPara = true;
      }
      // Продолжение абзаца, который прервал рисунок: строка со строчной буквы.
      const cont = dangling as { text: string } | null;
      if (newPara && cont && /^\p{Ll}/u.test(l.text) && (!para || CAPTION.test(para.text))) {
        flush();
        // Дальше строки клеим к нему же, пока абзац не кончится.
        para = { text: joinLines(cont.text, l.text), last: l, col: el.col, pos, into: cont };
        prevCol = el.col;
        continue;
      }
      if (newPara) {
        flush();
        para = { text: l.text, last: l, col: el.col, pos };
      } else {
        para!.text = joinLines(para!.text, l.text);
        para!.last = l;
      }
      prevCol = el.col;
    }
  });
  flush();

  // Главы — по закладкам. Если закладок верхнего уровня мало (книга делится на части),
  // берём второй уровень.
  let entries = data.outline.filter((o) => o.level === 1);
  const second = data.outline.filter((o) => o.level === 2);
  if (entries.length < 3 && second.length > entries.length) entries = data.outline;
  entries = [...entries].sort((a, b) => a.page - b.page || (a.y ?? 0) - (b.y ?? 0));

  const chapters: Chapter[] = [];
  if (entries.length) {
    const at = (pos: Pos) => {
      let ci = -1;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.page < pos.page || (e.page === pos.page && (e.y ?? 0) <= pos.top + 4)) ci = i;
        else break;
      }
      return ci;
    };
    const byEntry = new Map<number, Block[]>();
    for (const { block, pos } of out) {
      const ci = at(pos);
      byEntry.set(ci, [...(byEntry.get(ci) ?? []), block]);
    }
    for (const ci of [...byEntry.keys()].sort((a, b) => a - b)) {
      const blocks = byEntry.get(ci)!;
      const title = ci < 0 ? 'Начало' : entries[ci].title;
      // Заголовок, совпадающий с названием главы, второй раз не читаем.
      if (blocks[0]?.type === 'h' && normTitle(blocks[0].text).includes(normTitle(title)))
        blocks.shift();
      chapters.push({ title, blocks });
    }
  } else {
    // Без закладок — главы по нумерованным разделам верхнего уровня («1. Introduction»),
    // а если их нет — по всем заголовкам.
    const heads = out.filter((o) => o.block.type === 'h').map((o) => o.block as { text: string });
    const top = heads.filter((h) => isTopSection(h.text));
    const splitAt =
      top.length >= 2
        ? new Set(top)
        : heads.length >= 2 && heads.length <= 300
          ? new Set(heads)
          : new Set();
    let cur: Chapter = { title: data.title || fallbackTitle, blocks: [] };
    chapters.push(cur);
    for (const { block } of out) {
      if (splitAt.has(block as never)) {
        cur = { title: (block as { text: string }).text, blocks: [] };
        chapters.push(cur);
        continue;
      }
      cur.blocks.push(block);
    }
  }

  return {
    chapters: chapters.filter((c) => c.blocks.length),
    figures,
    crops,
    pageLabels: data.pages.map((p) => p.label),
    emptyPages,
  };
}
