// Обложки для полки: уменьшенная копия картинки из книги и цвета для сгенерированной
// обложки, когда своей нет (TXT, книга ещё не скачана на это устройство).

/** Ширина обложки на полке с запасом на экран с плотностью 3x. */
const THUMB_WIDTH = 360;

/** Уменьшает картинку до размера полки. Если не вышло — отдаёт как есть. */
export async function thumbnail(src: string): Promise<string> {
  try {
    const img = new Image();
    img.src = src;
    await Promise.race([
      img.decode(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    if (img.naturalWidth <= THUMB_WIDTH) return src;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * THUMB_WIDTH);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return src;
  }
}

/** Фон, текст и акцент — сдержанные «издательские» сочетания. */
const PALETTES: [string, string, string][] = [
  ['#1f3b57', '#f3efe6', '#e0b65a'],
  ['#23443a', '#eef2ea', '#c9a86a'],
  ['#5b1f2b', '#f6ece6', '#e3a46b'],
  ['#2f3640', '#f1f1ee', '#7fb3d5'],
  ['#c8913a', '#2a1f12', '#fff3df'],
  ['#1d5c63', '#f0f7f6', '#f2c14e'],
  ['#3d2b4f', '#f3eef7', '#e59ab8'],
  ['#e9e2d0', '#2b2620', '#a3402c'],
];

/** Цвета сгенерированной обложки: у каждой книги свои и всегда одни и те же. */
export function palette(key: string): [string, string, string] {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTES[Math.abs(h) % PALETTES.length];
}
