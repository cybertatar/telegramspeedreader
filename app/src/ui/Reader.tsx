import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Book } from '../book/types';
import { Player, type PauseReason } from '../engine/player';
import {
  buildStream,
  pageLabel,
  readingMs,
  sentenceStartOf,
  stepSentence,
  type CardItem,
  type Stream,
} from '../engine/stream';
import { loadProgress, PARSER_VERSION, saveProgress, type Settings } from '../store';
import { haptic, inTelegram, onDeactivate, setBack } from '../telegram';
import { CardView } from './CardView';
import { Context } from './Context';
import { IconBack, IconMinus, IconPlus, IconSettings, IconToc } from './icons';
import { Progress } from './Progress';
import { SettingsSheet } from './SettingsSheet';
import { Toc } from './Toc';
import { Word } from './Word';

const WPM_MIN = 100;
const WPM_MAX = 1000;
const WPM_STEP = 25;
/** Сколько пикселей вертикального движения пальца — один шаг скорости. */
const PX_PER_STEP = 18;

const clampWpm = (v: number) => Math.min(WPM_MAX, Math.max(WPM_MIN, v));

function minutes(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 1 ? '<1 мин' : `${m} мин`;
}

/** Значение, которое само пропадает через `ms`. */
function useFlash<T>() {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<number>(0);
  const flash = (v: T, ms: number) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setValue(null), ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return [value, flash, () => setValue(null)] as const;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  t: number;
  pos: number;
  wpm: number;
  kind: 'none' | 'speed' | 'swipe';
}

export function Reader(props: {
  book: Book;
  settings: Settings;
  onSettings: (s: Partial<Settings>) => void;
  onExit: () => void;
}) {
  const { book, settings } = props;
  const stream: Stream = useMemo(() => buildStream(book), [book]);
  const saved = useMemo(() => loadProgress(book.id), [book.id]);
  const last = stream.items.length - 1;

  // Место, сохранённое другой версией разбора, восстанавливаем по доле прочитанного.
  const start = saved
    ? saved.v === PARSER_VERSION
      ? saved.pos
      : Math.round(saved.share * last)
    : 0;
  const [pos, setPos] = useState(Math.max(0, Math.min(start, last)));
  const [wpm, setWpmState] = useState(saved?.wpm ?? settings.wpm);
  const [playing, setPlaying] = useState(false);
  const [reason, setReason] = useState<PauseReason>('jump');
  const [card, setCard] = useState<{ i: number; mode: 'stop' | 'view' } | null>(null);
  const [sheet, setSheet] = useState<'toc' | 'settings' | null>(null);
  const [glance, flashGlance] = useFlash<number>();
  const [chip, flashChip, hideChip] = useFlash<number>();
  const [toast, flashToast] = useFlash<string>();

  const cardByKey = useMemo(() => {
    const m = new Map<string, number>();
    stream.items.forEach((it, i) => it.kind === 'card' && !m.has(it.key) && m.set(it.key, i));
    return m;
  }, [stream]);
  const cardByBlock = useMemo(() => {
    const m = new Map<number, number>();
    stream.items.forEach((it, i) => it.kind === 'card' && m.set(it.block, i));
    return m;
  }, [stream]);

  const player = useMemo(() => {
    const p = new Player(stream, { ...settings, wpm });
    p.pos = pos;
    return p;
    // Плеер один на книгу; настройки обновляет эффект ниже.
  }, [stream]);

  const wpmRef = useRef(wpm);
  wpmRef.current = wpm;
  // `force` — сразу и в облако (пауза, сворачивание); при чтении — реже.
  const save = (force: unknown = true) =>
    saveProgress(
      book.id,
      {
        pos: player.pos,
        share: last > 0 ? player.pos / last : 0,
        wpm: wpmRef.current,
        at: Date.now(),
      },
      !!force,
    );

  useEffect(() => {
    player.settings = { ...settings, wpm };
  }, [settings, wpm]);

  useEffect(() => {
    const off = player.on((e) => {
      if (e.type === 'word') {
        setPos(e.pos);
        const it = stream.items[e.pos];
        if (it.kind === 'word' && it.mention) {
          const ci = cardByKey.get(it.mention);
          if (ci !== undefined) flashChip(ci, 3500);
        }
      } else if (e.type === 'state') {
        setPlaying(e.playing);
        if (!e.playing) {
          setReason(e.reason ?? 'user');
          save();
        }
      } else if (e.type === 'card') {
        setPos(e.pos);
        setCard({ i: e.pos, mode: 'stop' });
        haptic.stop();
      } else if (e.type === 'glance') {
        flashGlance(e.pos, 2500);
      } else if (e.type === 'rewind') {
        setPos(e.to);
        flashToast(e.scope === 'paragraph' ? '↺ С начала абзаца' : '↺ С начала предложения', 1600);
      }
    });

    // Свернули приложение, выключили экран — чтение встаёт.
    const onHide = () => {
      if (document.visibilityState === 'hidden') player.pause('auto');
      save();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    onDeactivate(() => player.pause('auto'));
    const autosave = window.setInterval(() => player.playing && save(false), 5000);

    return () => {
      off();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      clearInterval(autosave);
      player.pause('auto');
      save();
      player.dispose();
    };
  }, [player]);

  const setWpm = (v: number) => {
    v = clampWpm(v);
    if (v === wpmRef.current) return;
    wpmRef.current = v;
    setWpmState(v);
    player.settings = { ...player.settings, wpm: v };
    // Новая книга начнётся с последней выбранной скорости.
    props.onSettings({ wpm: v });
    haptic.tick();
  };

  const seek = (i: number) => {
    player.seek(i);
    setPos(player.pos);
    setReason('jump');
  };

  // Карточку, на которой встало чтение, закрыли — дальше следующее слово.
  const closeCard = () => {
    if (card?.mode === 'stop' && player.pos === card.i) seek(card.i + 1);
    setCard(null);
  };
  const continueAfterCard = () => {
    closeCard();
    if (settings.mode === 'tap') player.play();
  };
  const openCard = (i: number) => {
    player.pause('user');
    setSheet(null);
    setCard({ i, mode: 'view' });
  };
  const goToCard = (i: number) => {
    setCard(null);
    setSheet(null);
    seek(sentenceStartOf(stream, Math.max(0, i - 1)));
  };

  // Системная кнопка «Назад»: сначала закрывает шторки, потом — в библиотеку.
  useEffect(() => {
    setBack(() => {
      if (card) setCard(null);
      else if (sheet) setSheet(null);
      else props.onExit();
    });
    return () => setBack(null);
  }, [card, sheet]);

  // Клавиатура (Telegram на компьютере): пробел, стрелки.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (card || sheet) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        if (settings.mode === 'hold') player.play();
        else player.toggle();
      } else if (e.code === 'ArrowUp') setWpm(wpmRef.current + WPM_STEP);
      else if (e.code === 'ArrowDown') setWpm(wpmRef.current - WPM_STEP);
      else if (e.code === 'ArrowRight') seek(stepSentence(stream, player.pos, 1));
      else if (e.code === 'ArrowLeft') seek(stepSentence(stream, player.pos, -1));
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && settings.mode === 'hold') player.pause('user');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [card, sheet, settings.mode, player]);

  // Жесты на нижней половине экрана: держать — читать, вверх/вниз — скорость,
  // влево/вправо — предложения.
  const gesture = useRef<Gesture | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    if (gesture.current || card) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      pos: player.pos,
      wpm: wpmRef.current,
      kind: 'none',
    };
    if (settings.mode === 'hold') player.play();
  };
  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === 'none') {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) g.kind = 'speed';
      else if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) g.kind = 'swipe';
    }
    if (g.kind === 'speed') {
      setWpm(g.wpm + Math.round(-dy / PX_PER_STEP) * WPM_STEP);
      flashToast('speed', 900);
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    const dx = e.clientX - g.x;
    if (settings.mode === 'hold') player.pause('user');
    if (g.kind === 'swipe') {
      seek(stepSentence(stream, g.pos, dx < 0 ? 1 : -1));
      haptic.bump();
    } else if (settings.mode === 'tap' && g.kind === 'none' && performance.now() - g.t < 500) {
      player.toggle();
    }
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (gesture.current?.id !== e.pointerId) return;
    gesture.current = null;
    player.pause('user');
  };

  const item = stream.items[pos];
  const chapterIdx = item?.chapter ?? 0;
  const chapter = stream.chapters[chapterIdx];
  const left = readingMs(stream, pos, chapter.end, wpm, settings.pauseScale);
  const shownCard = card ? (stream.items[card.i] as CardItem) : null;
  const glanceCard = glance !== null ? (stream.items[glance] as CardItem) : null;
  const chipCard = chip !== null ? (stream.items[chip] as CardItem) : null;

  let hint = '';
  if (!playing) {
    if (reason === 'end') hint = 'Книга закончилась';
    else
      hint =
        settings.mode === 'hold' ? 'Держите палец здесь, чтобы читать' : 'Нажмите, чтобы читать';
  }

  return (
    <div class={`reader${playing ? ' is-playing' : ''}`}>
      <header class="reader-head">
        {!inTelegram && (
          <button class="icon-btn" onClick={props.onExit} aria-label="К библиотеке">
            <IconBack />
          </button>
        )}
        <div class="reader-title">
          <b>{chapter.title}</b>
          <span>
            стр. {pageLabel(stream, item?.page ?? 1)} из {stream.pageCount} · ещё {minutes(left)} в
            главе
          </span>
        </div>
        <button class="icon-btn" onClick={() => setSheet('toc')} aria-label="Оглавление">
          <IconToc />
        </button>
        <button class="icon-btn" onClick={() => setSheet('settings')} aria-label="Настройки">
          <IconSettings />
        </button>
      </header>

      <main class="reader-main">
        {!playing && stream.items.length > 0 ? (
          <Context
            stream={stream}
            pos={pos}
            cardByBlock={cardByBlock}
            onSeek={seek}
            onOpenCard={openCard}
          />
        ) : (
          <div class="context-idle">
            {glanceCard?.source.type === 'figure' && (
              <figure class="glance">
                <img src={book.figures[glanceCard.source.id]?.src} alt="" />
                <figcaption>{glanceCard.title}</figcaption>
              </figure>
            )}
          </div>
        )}
        {/* «Мельком» уже показывает ту же картинку — плашка ссылки там лишняя. */}
        {chipCard && playing && glance === null && (
          <button
            class="mention-chip"
            onClick={() => {
              hideChip();
              openCard(chip!);
            }}
          >
            {chipCard.source.type === 'figure' && (
              <img src={book.figures[chipCard.source.id]?.src} alt="" />
            )}
            <span>{chipCard.title}</span>
          </button>
        )}
      </main>

      <div
        class="pad"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ '--word-size': `${settings.fontSize}px` }}
      >
        <div class="stage">
          {item?.kind === 'word' ? (
            <Word text={item.text} mono={item.mono} />
          ) : item ? (
            <div class="word word-card">{item.title}</div>
          ) : null}
        </div>
        {toast && <div class="toast">{toast === 'speed' ? `${wpm} слов/мин` : toast}</div>}
        <div class="pad-hint">{hint}</div>
      </div>

      <footer class="reader-foot">
        <Progress stream={stream} pos={pos} onSeek={seek} />
        <div class="speed">
          <button class="icon-btn" onClick={() => setWpm(wpm - WPM_STEP)} aria-label="Медленнее">
            <IconMinus />
          </button>
          <span>
            <b>{wpm}</b> слов/мин
          </span>
          <button class="icon-btn" onClick={() => setWpm(wpm + WPM_STEP)} aria-label="Быстрее">
            <IconPlus />
          </button>
        </div>
      </footer>

      {sheet === 'toc' && (
        <Toc
          stream={stream}
          current={chapterIdx}
          onChapter={(i) => {
            setSheet(null);
            seek(i);
          }}
          onCard={openCard}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          settings={{ ...settings, wpm }}
          onChange={(s) => {
            if (s.wpm !== undefined) setWpm(s.wpm);
            else props.onSettings(s);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {shownCard && (
        <CardView
          card={shownCard}
          book={book}
          mode={card!.mode}
          onClose={closeCard}
          onContinue={continueAfterCard}
          onGoTo={() => goToCard(card!.i)}
        />
      )}
    </div>
  );
}
