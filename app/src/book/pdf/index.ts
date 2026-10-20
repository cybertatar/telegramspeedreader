// PDF → книга прямо в браузере: pdf.js достаёт текст и графику, `layout` раскладывает,
// рисунки, таблицы и формулы вырезаются картинками с отрисованной страницы.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { attachCaptions } from '../captions';
import type { Book } from '../types';
import { extractPdf } from './extract';
import { layoutPdf } from './layout';
import { ScannedPdf } from './errors';
import type { Crop } from './types';

export type Progress = (stage: 'read' | 'figures', done: number, total: number) => void;

/** Самая широкая вырезка в пикселях: хватает на увеличение на телефоне. */
const MAX_CROP_PX = 1100;

async function loadPdfjs() {
  // Старая сборка — с полифилами для не самых новых WebView в Telegram.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
    if (import.meta.env.MODE === 'preview') {
      // Превью — один HTML-файл: воркер собираем из строки.
      const { default: code } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw');
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
    } else {
      const { default: url } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = url;
    }
  }
  return pdfjs;
}

async function renderCrop(doc: PDFDocumentProxy, crop: Crop, maxPx = MAX_CROP_PX): Promise<string> {
  const page = await doc.getPage(crop.page + 1);
  const w = crop.x1 - crop.x0;
  const h = crop.bottom - crop.top;
  const scale = Math.min(2.5, maxPx / w);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    // Сдвигаем страницу так, чтобы нужный участок оказался в углу холста.
    transform: [1, 0, 0, 1, -crop.x0 * scale, -crop.top * scale],
  }).promise;
  page.cleanup();
  const webp = canvas.toDataURL('image/webp', 0.86);
  // Safari не умеет кодировать WebP и молча отдаёт PNG — это тоже годится.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

export async function parsePdf(bytes: Uint8Array, fileName: string, onProgress?: Progress) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc = await task.promise;
  try {
    const data = await extractPdf(doc, (d, t) => onProgress?.('read', d, t));
    const title = fileName.replace(/\.[^.]+$/, '');
    const layout = layoutPdf(data, data.title || title);
    if (layout.emptyPages > data.pages.length * 0.5)
      throw new ScannedPdf('В PDF почти нет текста — похоже, это скан');

    const ids = Object.keys(layout.crops);
    for (let i = 0; i < ids.length; i++) {
      onProgress?.('figures', i, ids.length);
      layout.figures[ids[i]].src = await renderCrop(doc, layout.crops[ids[i]]);
    }

    // Обложка — первая страница: у книг это обложка, у статей — титульный лист.
    const first = data.pages[0];
    const cover = first
      ? await renderCrop(
          doc,
          { page: 0, x0: 0, x1: first.width, top: 0, bottom: first.height },
          360,
        )
      : undefined;

    const book: Book = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: data.title && data.title.length > 3 ? data.title : (layout.titleGuess ?? title),
      cover,
      author: data.author || undefined,
      format: 'pdf',
      pageMode: 'source',
      chapters: layout.chapters,
      figures: layout.figures,
      pageLabels: layout.pageLabels,
    };
    attachCaptions(book);
    return book;
  } finally {
    task.destroy();
  }
}
