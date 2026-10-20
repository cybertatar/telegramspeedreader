import type { Settings } from '../store';
import { Sheet } from './Sheet';

function Segmented<T extends string>(props: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup">
      {props.options.map(([v, label]) => (
        <button
          role="radio"
          aria-checked={v === props.value}
          class={v === props.value ? 'is-on' : undefined}
          onClick={() => props.onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle(props: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="toggle">
      <span>
        {props.label}
        <small>{props.hint}</small>
      </span>
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
    </label>
  );
}

export function SettingsSheet(props: {
  settings: Settings;
  onChange: (s: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const s = props.settings;
  const num = (e: Event) => +(e.target as HTMLInputElement).value;
  return (
    <Sheet title="Настройки" onClose={props.onClose}>
      <section class="field">
        <div class="field-head">
          <span>Скорость</span>
          <b>{s.wpm} слов/мин</b>
        </div>
        <input
          type="range"
          min={100}
          max={1000}
          step={25}
          value={s.wpm}
          onInput={(e) => props.onChange({ wpm: num(e) })}
        />
        <small>Своя у каждой книги. Во время чтения — ведите палец вверх или вниз.</small>
      </section>

      <section class="field">
        <div class="field-head">
          <span>Как читать</span>
        </div>
        <Segmented
          value={s.mode}
          options={[
            ['hold', 'Держать палец'],
            ['tap', 'Нажатием'],
          ]}
          onChange={(mode) => props.onChange({ mode })}
        />
        <small>
          {s.mode === 'hold'
            ? 'Текст идёт, пока палец на экране. Отпустили — пауза.'
            : 'Касание запускает чтение, второе — останавливает.'}
        </small>
      </section>

      <section class="field">
        <div class="field-head">
          <span>Иллюстрации и листинги</span>
        </div>
        <Segmented
          value={s.figures}
          options={[
            ['stop', 'Останавливаться'],
            ['glance', 'Мельком'],
            ['skip', 'Пропускать'],
          ]}
          onChange={(figures) => props.onChange({ figures })}
        />
        <small>
          {s.figures === 'stop'
            ? 'Чтение встаёт, картинка открывается целиком.'
            : s.figures === 'glance'
              ? 'Картинка появляется на пару секунд, чтение идёт. Код и таблицы всё равно останавливают.'
              : 'Только отметки на полосе прогресса. Всё есть в оглавлении.'}
        </small>
      </section>

      <section class="field">
        <div class="field-head">
          <span>Паузы на знаках препинания</span>
          <b>{s.pauseScale === 0 ? 'нет' : `×${s.pauseScale.toFixed(1)}`}</b>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.25}
          value={s.pauseScale}
          onInput={(e) => props.onChange({ pauseScale: num(e) })}
        />
      </section>

      <section class="field">
        <div class="field-head">
          <span>Размер слова</span>
          <b>{s.fontSize}</b>
        </div>
        <input
          type="range"
          min={28}
          max={60}
          step={2}
          value={s.fontSize}
          onInput={(e) => props.onChange({ fontSize: num(e) })}
        />
      </section>

      <Toggle
        label="Возвращать после паузы"
        hint="Дольше 2 секунд — к началу предложения, дольше минуты — к началу абзаца"
        value={s.rewind}
        onChange={(rewind) => props.onChange({ rewind })}
      />
      <Toggle
        label="Плавный разгон"
        hint="Первые секунды после паузы чуть медленнее"
        value={s.ramp}
        onChange={(ramp) => props.onChange({ ramp })}
      />
    </Sheet>
  );
}
