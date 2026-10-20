import { describe, expect, it } from 'vitest';
import { demoBook } from '../book/demo';
import type { Book } from '../book/types';
import { orpIndex } from './orp';
import { Player, type Clock } from './player';
import {
  buildStream,
  sentenceStartOf,
  splitLong,
  stepSentence,
  tokenize,
  type CardItem,
  type WordItem,
} from './stream';

const book = (paragraphs: string[], extra: Partial<Book> = {}): Book => ({
  id: 't',
  title: 't',
  format: 'txt',
  pageMode: 'virtual',
  figures: {},
  chapters: [{ title: 'Ch', blocks: paragraphs.map((text) => ({ type: 'p' as const, text })) }],
  ...extra,
});

describe('tokenize', () => {
  it('приклеивает одинокое тире к предыдущему слову', () => {
    expect(tokenize('Он — врач').map((t) => t.text)).toEqual(['Он\u00a0—', 'врач']);
  });
});

describe('splitLong', () => {
  it('режет длинные слова, оставляя знаки на краях', () => {
    expect(splitLong('«интернационализация»,')).toEqual(['«интернацио-', 'нализация»,']);
    expect(splitLong('слово')).toEqual(['слово']);
  });
});

describe('orpIndex', () => {
  it('ставит опорную букву левее середины и пропускает кавычки', () => {
    expect(orpIndex('а')).toBe(0);
    expect(orpIndex('чтение')).toBe(2);
    expect(orpIndex('«дом')).toBe(2);
  });
});

describe('buildStream', () => {
  it('отмечает начала предложений, но не после «рис.»', () => {
    const s = buildStream(book(['Смотри рис. 2 тут. Второе предложение.']));
    const starts = s.items
      .filter((i) => (i as WordItem).sentenceStart)
      .map((i) => (i as WordItem).text);
    expect(starts).toEqual(['Смотри', 'Второе']);
  });

  it('делит на страницы по 250 слов', () => {
    const s = buildStream(book([Array(600).fill('слово').join(' ')]));
    expect(s.pageCount).toBe(3);
    expect(s.items[250].page).toBe(2);
  });

  it('показывает рисунок в конце предложения с первой ссылкой, а не на месте вёрстки', () => {
    const s = buildStream(demoBook);
    const ch = s.chapters[1];
    const cardIdx = ch.cards[0];
    const card = s.items[cardIdx] as CardItem;
    expect(card.title).toBe('Рис. 1.1');
    expect((s.items[cardIdx - 1] as WordItem).text).toBe('1.1.');
    // на исходном месте (в конце главы) рисунок второй раз не показывается
    expect(ch.cards).toHaveLength(1);
    // а в тексте на паузе рисунок стоит на своём месте
    expect(s.blocks[card.block].source.type).toBe('figure');
  });

  it('оставляет рисунок на месте, если ссылка после него', () => {
    const s = buildStream(demoBook);
    const titles = s.chapters[2].cards.map((i) => (s.items[i] as CardItem).title);
    expect(titles).toEqual(['Рис. 2.1', 'Таблица 2.1']);
  });
});

function fakeClock() {
  let t = 0;
  let queue: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => (queue.push({ at: t + ms, fn, id: ++id }), id),
    clearTimeout: (x) => (queue = queue.filter((q) => q.id !== x)),
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > end) break;
      queue.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { clock, advance };
}

const settings = { wpm: 600, pauseScale: 1, figures: 'stop' as const, rewind: true, ramp: false };

describe('Player', () => {
  const text = 'Первое предложение тут. Второе предложение длинное очень. Третье.';

  it('после короткой паузы продолжает с того же слова', () => {
    const { clock, advance } = fakeClock();
    const pl = new Player(buildStream(book([text])), settings, clock);
    pl.play();
    advance(450);
    pl.pause();
    const at = pl.pos;
    advance(1000);
    pl.play();
    expect(pl.pos).toBe(at);
  });

  it('после паузы в несколько секунд откатывает к началу предложения', () => {
    const { clock, advance } = fakeClock();
    const s = buildStream(book([text]));
    const pl = new Player(s, settings, clock);
    pl.seek(5); // «длинное»
    pl.play();
    pl.pause();
    advance(5000);
    pl.play();
    expect(pl.pos).toBe(sentenceStartOf(s, 5));
    expect((s.items[pl.pos] as WordItem).text).toBe('Второе');
  });

  it('после долгой паузы откатывает к началу абзаца', () => {
    const { clock, advance } = fakeClock();
    const pl = new Player(buildStream(book([text])), settings, clock);
    pl.seek(5);
    pl.play();
    pl.pause();
    advance(120000);
    pl.play();
    expect(pl.pos).toBe(0);
  });

  it('останавливается на карточке и продолжает после неё', () => {
    const { clock, advance } = fakeClock();
    const s = buildStream(demoBook);
    const pl = new Player(s, settings, clock);
    const card = s.chapters[1].cards[0];
    pl.seek(card - 2);
    pl.play();
    advance(5000);
    expect(pl.playing).toBe(false);
    expect(pl.pauseReason).toBe('card');
    expect(pl.pos).toBe(card);
    pl.play();
    expect(pl.pos).toBe(card + 1);
  });

  it('в режиме «пропускать» проходит карточку не останавливаясь', () => {
    const { clock, advance } = fakeClock();
    const s = buildStream(demoBook);
    const pl = new Player(s, { ...settings, figures: 'skip' }, clock);
    const card = s.chapters[1].cards[0];
    pl.seek(card - 1);
    pl.play();
    advance(3000);
    expect(pl.pos).toBeGreaterThan(card);
    expect(pl.playing).toBe(true);
  });
});

describe('stepSentence', () => {
  it('листает предложения вперёд и назад', () => {
    const s = buildStream(book(['Раз два. Три четыре. Пять.']));
    expect(stepSentence(s, 0, 1)).toBe(2);
    expect(stepSentence(s, 3, -1)).toBe(2);
    expect(stepSentence(s, 2, -1)).toBe(0);
  });
});
