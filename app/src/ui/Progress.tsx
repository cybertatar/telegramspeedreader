import { useRef, useState } from 'preact/hooks';
import { chapterAt, sentenceStartOf, type Stream } from '../engine/stream';

/**
 * Полоса прогресса книги: засечки глав, точки иллюстраций. Её можно тянуть
 * пальцем — подпись показывает, в какую главу и на какую страницу попадёшь.
 */
export function Progress(props: { stream: Stream; pos: number; onSeek: (i: number) => void }) {
  const { stream } = props;
  const n = Math.max(1, stream.items.length - 1);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return Math.round(share * n);
  };

  const shown = drag ?? props.pos;
  const item = stream.items[shown];
  const label =
    drag !== null && item
      ? `${stream.chapters[chapterAt(stream, shown)].title} · стр. ${item.page}`
      : null;

  return (
    <div
      class="progress"
      ref={ref}
      onPointerDown={(e) => {
        ref.current!.setPointerCapture(e.pointerId);
        setDrag(at(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(at(e))}
      onPointerUp={(e) => {
        if (drag === null) return;
        setDrag(null);
        props.onSeek(sentenceStartOf(stream, at(e)));
      }}
      onPointerCancel={() => setDrag(null)}
      role="slider"
      aria-label="Место в книге"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={props.pos}
    >
      <div class="progress-track">
        <div class="progress-fill" style={{ width: `${(shown / n) * 100}%` }} />
        {stream.chapters.slice(1).map((c) => (
          <i class="progress-tick" style={{ left: `${(c.start / n) * 100}%` }} />
        ))}
        {stream.chapters.flatMap((c) =>
          c.cards.map((i) => <i class="progress-dot" style={{ left: `${(i / n) * 100}%` }} />),
        )}
      </div>
      {label && <div class="progress-label">{label}</div>}
    </div>
  );
}
