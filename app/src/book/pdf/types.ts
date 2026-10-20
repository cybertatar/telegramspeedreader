// Сырьё из PDF для раскладки. Координаты — в пунктах от левого верхнего угла страницы.

export interface PdfItem {
  str: string;
  x: number;
  /** Базовая линия. */
  y: number;
  w: number;
  size: number;
  font: string;
}

export interface Box {
  kind: 'image' | 'path';
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface PdfPage {
  index: number;
  width: number;
  height: number;
  /** Подпись страницы из PDF: «xii», «147». */
  label: string;
  items: PdfItem[];
  boxes: Box[];
}

export interface OutlineEntry {
  title: string;
  level: number;
  page: number;
  /** Верх закладки на странице, если указан. */
  y: number | null;
}

export interface PdfData {
  pages: PdfPage[];
  outline: OutlineEntry[];
  fonts: Record<string, { family: string }>;
  title?: string;
  author?: string;
}

/** Участок страницы, который надо вырезать картинкой: рисунок, таблица, формула. */
export interface Crop {
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}
