import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseEpub } from './epub';

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${body}</body></html>`;

function makeEpub() {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Сети для всех</dc:title><dc:creator>Анна Иванова</dc:creator></metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="pic" href="img/scheme.png" media-type="image/png"/>
<item id="cov" href="img/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
    'OEBPS/nav.xhtml': strToU8(
      xhtml(`<nav epub:type="toc"><ol>
<li><a href="text/ch1.xhtml">Глава 1. Пакеты</a></li>
<li><a href="text/ch2.xhtml">Глава 2. Маршруты</a><ol><li><a href="text/ch2.xhtml#deep">Подробности</a></li></ol></li>
<li><a href="text/ch2.xhtml#end">Глава 3. Итоги</a></li>
</ol></nav>`),
    ),
    'OEBPS/text/ch1.xhtml': strToU8(
      xhtml(`<img src="../img/cover.jpg" alt="Обложка"/><h1>Глава 1. Пакеты</h1>
<p>Данные идут <em>пакетами</em>, см. рис. 1.1 ниже.<a epub:type="noteref" href="#n1">1</a></p>
<div class="figure"><img src="../img/scheme.png" alt=""/><p>Рис. 1.1. Схема сети</p></div>
<pre><code>$ ping example.com
64 bytes from example.com</code></pre>
<table><tr><th>Порт</th><th>Протокол</th></tr><tr><td>80</td><td>HTTP</td></tr></table>
<aside epub:type="footnote" id="n1"><p>Сноска не читается.</p></aside>`),
    ),
    'OEBPS/text/ch2.xhtml': strToU8(
      xhtml(`<h1>Глава 2. Маршруты</h1><p>Первый абзац.</p><h2 id="deep">Подробности</h2><p>Второй.</p>
<section id="end"><h1>Глава 3. Итоги</h1><p>Конец.</p></section>`),
    ),
    'OEBPS/img/scheme.png': new Uint8Array(2000).fill(7),
    'OEBPS/img/cover.jpg': new Uint8Array(3000).fill(9),
  });
}

describe('parseEpub', () => {
  const book = parseEpub(makeEpub(), 'net.epub');

  it('находит обложку и не показывает её в тексте карточкой', () => {
    expect(book.cover?.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(Object.keys(book.figures)).toHaveLength(1);
  });

  it('берёт название, автора и главы из оглавления', () => {
    expect(book.title).toBe('Сети для всех');
    expect(book.author).toBe('Анна Иванова');
    expect(book.chapters.map((c) => c.title)).toEqual([
      'Глава 1. Пакеты',
      'Глава 2. Маршруты',
      'Глава 3. Итоги',
    ]);
  });

  it('раскладывает текст, код, таблицу и рисунок с подписью', () => {
    const [ch1] = book.chapters;
    expect(ch1.blocks.map((b) => b.type)).toEqual(['p', 'figure', 'code', 'table']);
    expect(ch1.blocks[0]).toEqual({ type: 'p', text: 'Данные идут пакетами, см. рис. 1.1 ниже.' });
    const fig = Object.values(book.figures)[0];
    expect(fig).toMatchObject({ label: '1.1', caption: 'Схема сети' });
    expect(fig.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(ch1.blocks[2]).toMatchObject({ text: '$ ping example.com\n64 bytes from example.com' });
  });

  it('вложенные пункты оглавления остаются подзаголовками внутри главы', () => {
    expect(book.chapters[1].blocks).toEqual([
      { type: 'p', text: 'Первый абзац.' },
      { type: 'h', text: 'Подробности' },
      { type: 'p', text: 'Второй.' },
    ]);
  });
});
