import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Stream } from '../engine/stream';
import { IconCode, IconImage, IconTable } from './icons';

const BEFORE = 4;
const AFTER = 6;

/**
 * Текст на паузе: соседние абзацы главы, текущее слово подсвечено.
 * Нажатие на слово — продолжить с него.
 */
export function Context(props: {
  stream: Stream;
  pos: number;
  cardByBlock: Map<number, number>;
  onSeek: (i: number) => void;
  onOpenCard: (i: number) => void;
}) {
  const { stream, pos } = props;
  const ref = useRef<HTMLDivElement>(null);

  // Подсвечиваем слово целиком (у частей длинного — первую часть), а на карточке —
  // слово перед ней: это предложение со ссылкой на рисунок.
  let cur = Math.min(pos, stream.items.length - 1);
  while (cur > 0) {
    const it = stream.items[cur];
    if (it.kind === 'word' && it.ctx !== undefined) break;
    cur--;
  }
  const item = stream.items[cur];
  const chapter = stream.chapters[item?.chapter ?? 0];
  const blockIdx = item?.block ?? 0;

  const firstBlock = stream.items[chapter.start]?.block ?? 0;
  const lastBlock = stream.items[chapter.end - 1]?.block ?? 0;
  const from = Math.max(firstBlock, blockIdx - BEFORE);
  const to = Math.min(lastBlock, blockIdx + AFTER);

  useLayoutEffect(() => {
    ref.current?.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }, [cur]);

  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i],[data-card]');
    if (!el) return;
    if (el.dataset.card) props.onOpenCard(+el.dataset.card);
    else props.onSeek(+el.dataset.i!);
  };

  const blocks = [];
  for (let b = from; b <= to; b++) {
    const sb = stream.blocks[b];
    const src = sb.source;
    if (src.type === 'p' || src.type === 'h') {
      const words = [];
      for (let i = sb.start; i < sb.end; i++) {
        const it = stream.items[i];
        if (it.kind !== 'word' || it.ctx === undefined) continue;
        words.push(
          <span data-i={i} class={i === cur ? 'w is-current' : 'w'}>
            {it.ctx}
          </span>,
          ' ',
        );
      }
      blocks.push(src.type === 'h' ? <h3>{words}</h3> : <p>{words}</p>);
    } else {
      const ci = props.cardByBlock.get(b);
      if (ci === undefined) continue;
      const card = stream.items[ci];
      if (card.kind !== 'card') continue;
      const Icon =
        card.cardType === 'figure' ? IconImage : card.cardType === 'code' ? IconCode : IconTable;
      const fig = src.type === 'figure' ? stream.book.figures[src.id] : undefined;
      blocks.push(
        <button class="ctx-card" data-card={ci}>
          {fig ? <img src={fig.src} alt="" /> : <Icon />}
          <span>{card.title}</span>
        </button>,
      );
    }
  }

  return (
    <div class="context" ref={ref} onClick={onClick}>
      {from === firstBlock && <h2 class="ctx-chapter">{chapter.title}</h2>}
      {blocks}
    </div>
  );
}
