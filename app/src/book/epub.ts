// EPUB → книга: архив распаковывается в браузере, порядок файлов — из spine,
// главы — из оглавления книги (nav в EPUB 3 или toc.ncx в EPUB 2).

import { unzipSync } from 'fflate';
import { attachCaptions } from './captions';
import type { Book, Chapter, Figure } from './types';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Картинки меньше — значки и украшения, в поток не берём. */
const MIN_IMAGE_BYTES = 1200;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Путь относительно файла: «OEBPS/text/ch1.xhtml» + «../img/a.png» → «OEBPS/img/a.png». */
function resolve(base: string, href: string) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function parseXml(text: string, type: DOMParserSupportedType = 'application/xhtml+xml') {
  const doc = new DOMParser().parseFromString(text, type);
  // Многие EPUB — не совсем валидный XHTML: тогда читаем как обычный HTML.
  if (doc.getElementsByTagName('parsererror').length && type !== 'text/html')
    return new DOMParser().parseFromString(text, 'text/html');
  return doc;
}

const byLocal = (el: Element | Document, name: string) =>
  Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);

interface TocEntry {
  title: string;
  file: string;
  frag: string;
  level: number;
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'blockquote',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'pre',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'svg',
  'aside',
  'nav',
]);
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'nav', 'template']);

export function parseEpub(bytes: Uint8Array, fileName: string): Book {
  const files = unzipSync(bytes);
  const text = (path: string) => (files[path] ? new TextDecoder().decode(files[path]) : null);

  const container = text('META-INF/container.xml');
  if (!container) throw new Error('Это не EPUB: нет META-INF/container.xml');
  const opfPath = byLocal(parseXml(container, 'application/xml'), 'rootfile')[0]?.getAttribute(
    'full-path',
  );
  const opfText = opfPath && text(opfPath);
  if (!opfPath || !opfText) throw new Error('В EPUB нет описания книги (OPF)');
  const opf = parseXml(opfText, 'application/xml');

  const title =
    clean(byLocal(opf, 'title')[0]?.textContent ?? '') || fileName.replace(/\.[^.]+$/, '');
  const author = clean(byLocal(opf, 'creator')[0]?.textContent ?? '') || undefined;

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of byLocal(opf, 'item'))
    manifest.set(it.getAttribute('id') ?? '', {
      href: resolve(opfPath, it.getAttribute('href') ?? ''),
      type: it.getAttribute('media-type') ?? '',
      props: it.getAttribute('properties') ?? '',
    });
  const spineEl = byLocal(opf, 'spine')[0];
  const spine = byLocal(opf, 'itemref')
    .filter((r) => r.getAttribute('linear') !== 'no')
    .map((r) => manifest.get(r.getAttribute('idref') ?? '')?.href)
    .filter((h): h is string => !!h && !!files[h]);

  // Оглавление.
  const toc: TocEntry[] = [];
  const navItem = [...manifest.values()].find((m) => m.props.split(' ').includes('nav'));
  const ncxItem =
    manifest.get(spineEl?.getAttribute('toc') ?? '') ??
    [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  if (navItem && text(navItem.href)) {
    const nav = parseXml(text(navItem.href)!);
    const navs = byLocal(nav, 'nav');
    const tocNav =
      navs.find(
        (n) =>
          (n.getAttribute('epub:type') ??
            n.getAttributeNS('http://www.idpf.org/2007/ops', 'type')) === 'toc',
      ) ?? navs[0];
    const walk = (ol: Element, level: number) => {
      for (const li of Array.from(ol.children).filter((c) => c.localName === 'li')) {
        const a = Array.from(li.children).find(
          (c) => c.localName === 'a' || c.localName === 'span',
        );
        const href = a?.getAttribute('href');
        if (a && href)
          toc.push({
            title: clean(a.textContent ?? ''),
            file: resolve(navItem.href, href),
            frag: href.split('#')[1] ?? '',
            level,
          });
        const sub = Array.from(li.children).find((c) => c.localName === 'ol');
        if (sub) walk(sub, level + 1);
      }
    };
    const ol = tocNav && byLocal(tocNav, 'ol')[0];
    if (ol) walk(ol, 1);
  } else if (ncxItem && text(ncxItem.href)) {
    const ncx = parseXml(text(ncxItem.href)!, 'application/xml');
    const walk = (el: Element, level: number) => {
      for (const np of Array.from(el.children).filter((c) => c.localName === 'navPoint')) {
        const label = byLocal(np, 'text')[0]?.textContent ?? '';
        const src = byLocal(np, 'content')[0]?.getAttribute('src') ?? '';
        if (src)
          toc.push({
            title: clean(label),
            file: resolve(ncxItem.href, src),
            frag: src.split('#')[1] ?? '',
            level,
          });
        walk(np, level + 1);
      }
    };
    const navMap = byLocal(ncx, 'navMap')[0];
    if (navMap) walk(navMap, 1);
  }

  // Главы — верхний уровень оглавления; если там всего пара частей — второй тоже.
  let entries = toc.filter((t) => t.level === 1);
  if (entries.length < 3 && toc.some((t) => t.level === 2))
    entries = toc.filter((t) => t.level <= 2);
  const startsAt = new Map<string, TocEntry>();
  for (const e of entries) {
    const key = e.file + '#' + e.frag;
    if (!startsAt.has(key)) startsAt.set(key, e);
  }

  const figures: Record<string, Figure> = {};
  const chapters: Chapter[] = [];
  let current: Chapter = { title: 'Начало', blocks: [] };
  chapters.push(current);
  const startChapter = (e: TocEntry) => {
    current = { title: e.title, blocks: [] };
    chapters.push(current);
  };

  for (const path of spine) {
    const doc = parseXml(text(path)!);
    const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
    const atStart = startsAt.get(path + '#');
    if (atStart) startChapter(atStart);

    let inline = '';
    const flushInline = () => {
      const t = clean(inline);
      if (t) current.blocks.push({ type: 'p', text: t });
      inline = '';
    };
    const addImage = (src: string | null, alt?: string) => {
      if (!src) return;
      const p = resolve(path, src);
      const data = files[p];
      if (!data || data.length < MIN_IMAGE_BYTES) return;
      const ext = p.split('.').pop()?.toLowerCase() ?? '';
      const id = `img${Object.keys(figures).length + 1}`;
      figures[id] = {
        id,
        src: `data:${MIME[ext] ?? 'image/png'};base64,${toBase64(data)}`,
        caption: alt && alt.length > 3 ? alt : undefined,
      };
      flushInline();
      current.blocks.push({ type: 'figure', id });
    };

    const walk = (el: Element) => {
      const id = el.getAttribute('id');
      if (id) {
        const e = startsAt.get(path + '#' + id);
        if (e) {
          flushInline();
          startChapter(e);
        }
      }
      const tag = el.localName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      // Сноски EPUB 3 в поток не берём; метки сносок в тексте — тоже.
      const epubType = el.getAttribute('epub:type') ?? '';
      if (/footnote|endnote|rearnote|pagebreak/.test(epubType)) return;
      if (/noteref/.test(epubType)) return;

      if (/^h[1-6]$/.test(tag)) {
        flushInline();
        const t = clean(el.textContent ?? '');
        if (t) current.blocks.push({ type: 'h', text: t });
        return;
      }
      if (tag === 'pre') {
        flushInline();
        const t = (el.textContent ?? '').replace(/\s+$/, '');
        if (t.trim()) current.blocks.push({ type: 'code', text: t });
        return;
      }
      if (tag === 'table') {
        flushInline();
        const rows = byLocal(el, 'tr')
          .map((tr) =>
            Array.from(tr.children)
              .filter((c) => c.localName === 'td' || c.localName === 'th')
              .map((c) => clean(c.textContent ?? '')),
          )
          .filter((r) => r.some(Boolean));
        // Таблица из одной ячейки — это вёрстка (врезка), а не данные: читаем как текст.
        if (rows.length === 1 && rows[0].length <= 2) {
          for (const c of byLocal(el, 'td')) walkChildren(c);
          flushInline();
        } else if (rows.length) current.blocks.push({ type: 'table', rows });
        return;
      }
      if (tag === 'img') {
        addImage(el.getAttribute('src'), el.getAttribute('alt') ?? undefined);
        return;
      }
      if (tag === 'image') {
        addImage(el.getAttribute('xlink:href') ?? el.getAttribute('href'));
        return;
      }
      if (tag === 'br') {
        inline += ' ';
        return;
      }
      if (BLOCK_TAGS.has(tag)) {
        flushInline();
        walkChildren(el);
        flushInline();
        return;
      }
      walkChildren(el);
    };
    const walkChildren = (el: Element) => {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3) inline += node.textContent;
        else if (node.nodeType === 1) walk(node as Element);
      }
    };
    walkChildren(body);
    flushInline();
  }

  // Заголовок, совпадающий с названием главы, второй раз не читаем.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  for (const ch of chapters) {
    const first = ch.blocks[0];
    if (first?.type === 'h' && norm(first.text).endsWith(norm(ch.title))) ch.blocks.shift();
  }

  // Обложка: EPUB 3 — `properties="cover-image"`, EPUB 2 — `<meta name="cover" content="id">`.
  const coverId = byLocal(opf, 'meta')
    .find((m) => m.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const coverItem =
    [...manifest.values()].find((m) => m.props.split(' ').includes('cover-image')) ??
    (coverId ? manifest.get(coverId) : undefined) ??
    [...manifest.values()].find((m) => m.type.startsWith('image/') && /cover/i.test(m.href));
  const coverData = coverItem && files[coverItem.href];
  const cover =
    coverData && coverItem?.type.startsWith('image/')
      ? `data:${coverItem.type};base64,${toBase64(coverData)}`
      : undefined;

  const book: Book = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title,
    author,
    cover,
    format: 'epub',
    pageMode: 'virtual',
    // Пустые главы и «Начало» из одной обложки не нужны.
    chapters: chapters.filter(
      (c) =>
        c.blocks.length && !(c.title === 'Начало' && c.blocks.every((b) => b.type === 'figure')),
    ),
    figures,
  };
  attachCaptions(book);
  return book;
}
