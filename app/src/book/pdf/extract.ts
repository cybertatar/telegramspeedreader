// Достаёт из PDF сырьё для раскладки: кусочки текста с координатами и шрифтами,
// рамки картинок и векторной графики, закладки и подписи страниц.
// Работает с pdf.js и в браузере, и в Node (для отладки на настоящих книгах).

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Box, OutlineEntry, PdfData, PdfItem, PdfPage } from './types';

// Номера операций pdf.js (`OPS`), стабильны между версиями.
const OP = {
  save: 10,
  restore: 11,
  transform: 12,
  shadingFill: 62,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
  paintSolidColorImageMask: 90,
  constructPath: 91,
} as const;

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function transformBox(m: Matrix, x0: number, y0: number, x1: number, y1: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
}

/**
 * Проходит по операциям отрисовки страницы и собирает рамки картинок и фигур
 * в координатах страницы (y вниз от верха).
 */
function graphicsBoxes(
  fnArray: number[],
  argsArray: unknown[][],
  height: number,
  offsetX: number,
  offsetY: number,
) {
  const boxes: Box[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const push = (kind: Box['kind'], b: readonly [number, number, number, number]) => {
    const x0 = b[0] - offsetX;
    const x1 = b[2] - offsetX;
    const top = height - (b[3] - offsetY);
    const bottom = height - (b[1] - offsetY);
    if (x1 - x0 < 0.5 && bottom - top < 0.5) return;
    boxes.push({ kind, x0, x1, top, bottom });
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OP.save:
        stack.push(ctm);
        break;
      case OP.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case OP.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case OP.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as Matrix);
        break;
      case OP.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OP.paintImageXObject:
      case OP.paintInlineImageXObject:
      case OP.paintImageMaskXObject:
      case OP.paintImageXObjectRepeat:
      case OP.paintSolidColorImageMask:
        // Картинка рисуется в единичный квадрат текущей матрицы.
        push('image', transformBox(ctm, 0, 0, 1, 1));
        break;
      case OP.constructPath: {
        const minMax = args[2] as ArrayLike<number> | null;
        if (minMax && minMax.length === 4 && Number.isFinite(minMax[0]))
          push('path', transformBox(ctm, minMax[0], minMax[1], minMax[2], minMax[3]));
        break;
      }
      case OP.shadingFill:
        break;
    }
  }
  return boxes;
}

// Лигатуры, мягкие переносы и значки из личной области Юникода (иконки шрифтов).
const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
};
export const normalizeText = (s: string) =>
  s.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c).replace(/[­-]/g, '');

async function resolveOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline) return [];
  const out: OutlineEntry[] = [];
  const walk = async (items: typeof outline, level: number) => {
    for (const it of items) {
      let page = -1;
      let y: number | null = null;
      try {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
        if (dest && dest[0]) {
          page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0] as never);
          if (dest[1]?.name === 'XYZ' && typeof dest[3] === 'number') y = dest[3];
          else if (dest[1]?.name === 'FitH' && typeof dest[2] === 'number') y = dest[2];
        }
      } catch {
        /* битая ссылка в закладке — пропускаем */
      }
      if (page >= 0) out.push({ title: normalizeText(it.title).trim(), level, page, y });
      if (it.items?.length && level < 2) await walk(it.items, level + 1);
    }
  };
  await walk(outline, 1);
  return out;
}

export async function extractPdf(
  doc: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfData> {
  const pages: PdfPage[] = [];
  const labels = await doc.getPageLabels().catch(() => null);
  const fonts: PdfData['fonts'] = {};
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const width = x1 - x0;
    const height = y1 - y0;
    const tc = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const str = normalizeText(it.str);
      if (!str) continue;
      const [a, b, , , e, f] = it.transform as number[];
      const size = Math.hypot(a, b);
      // Повёрнутый текст (подписи осей, поля) в поток не берём.
      if (size < 1 || Math.abs(b) > 0.01 * size) continue;
      items.push({ str, x: e - x0, y: height - (f - y0), w: it.width, size, font: it.fontName });
      if (!fonts[it.fontName]) {
        const st = tc.styles[it.fontName];
        fonts[it.fontName] = { family: st?.fontFamily ?? '' };
      }
    }
    const ops = await page.getOperatorList();
    const boxes = graphicsBoxes(ops.fnArray, ops.argsArray, height, x0, y0);
    pages.push({ index: n - 1, width, height, label: labels?.[n - 1] ?? String(n), items, boxes });
    page.cleanup();
    onProgress?.(n, doc.numPages);
  }
  const outline = await resolveOutline(doc);
  // y закладок — в координатах PDF (вверх от низа), переводим.
  for (const o of outline) if (o.y !== null && pages[o.page]) o.y = pages[o.page].height - o.y;
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
  return { pages, outline, fonts, title: info.Title?.trim(), author: info.Author?.trim() };
}
