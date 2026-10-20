// Бот и маленький API для мини-аппа. Своего хранилища нет: книги лежат в Telegram
// (в чате с ботом), Worker только помнит токен бота и передаёт файлы.
//
//   POST /bot     — вебхук Telegram: книгу прислали в чат → кнопка «Читать».
//   GET  /setup   — один раз после деплоя: вебхук, кнопка меню, команды.
//   GET  /file    — мини-апп скачивает книгу по file_id (токен бота наружу не уходит).
//   POST /upload  — мини-апп сохраняет книгу, добавленную кнопкой, в чат с ботом,
//                   чтобы она появилась на других устройствах.

import { verifyInitData, type TgUser } from './auth';

export interface Env {
  BOT_TOKEN: string;
  /** Секрет вебхука и ключ для /setup. */
  WEBHOOK_SECRET: string;
  /** Адрес мини-аппа, например https://cybertatar.github.io/telegramspeedreader/ */
  APP_URL: string;
}

/** Больше Bot API скачать не даёт. */
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;
/** Больше Bot API отправить не даёт. */
export const UPLOAD_LIMIT = 50 * 1024 * 1024;

export const FORMATS = ['epub', 'fb2', 'pdf', 'txt'];

// Тексты бота. DESCRIPTION видно в пустом чате до «Старт» (до 512 символов),
// SHORT_DESCRIPTION — в профиле бота и при пересылке ссылки (до 120).
export const DESCRIPTION =
  'Читайте книги быстрее: слова появляются по одному в центре экрана, и глазам не нужно бегать по строке.\n\n' +
  '• Держите палец на экране — текст идёт, отпустили — пауза. Ничего не убежит, пока вы отвлеклись.\n' +
  '• Скорость от 100 до 1000 слов в минуту, главы и страницы, иллюстрации и код целиком.\n' +
  '• EPUB, FB2, PDF и TXT — просто пришлите файл в чат.';
export const SHORT_DESCRIPTION =
  'Быстрое чтение книг по одному слову. Пришлите EPUB, FB2, PDF или TXT — и читайте.';
const WELCOME =
  'Привет! Пришлите книгу файлом — EPUB, FB2, PDF или TXT, — и под ней появится кнопка «Читать».\n\n' +
  'Слова показываются по одному в центре экрана. Держите палец внизу экрана — текст идёт, ' +
  'отпустите — пауза. Скорость меняется свайпом вверх и вниз.\n\n' +
  'Все ваши книги — в «Библиотеке», кнопка слева от поля ввода. С неё же можно начать: там есть ' +
  'короткая книга-инструкция.';

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

interface TgDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  file_size?: number;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
  document?: TgDocument;
}

async function api<T = unknown>(env: Env, method: string, body: unknown): Promise<T> {
  const init: RequestInit =
    body instanceof FormData
      ? { method: 'POST', body }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, init);
  const data = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

/** Ссылка, по которой мини-апп откроет именно эту книгу. */
export function readUrl(env: Env, doc: TgDocument) {
  const url = new URL(env.APP_URL);
  url.searchParams.set('file', doc.file_id);
  url.searchParams.set('uid', doc.file_unique_id);
  if (doc.file_name) url.searchParams.set('name', doc.file_name);
  return url.toString();
}

const readButton = (env: Env, doc: TgDocument) => ({
  inline_keyboard: [[{ text: '📖 Читать', web_app: { url: readUrl(env, doc) } }]],
});

export async function handleMessage(env: Env, msg: TgMessage) {
  const chat_id = msg.chat.id;
  if (msg.chat.type !== 'private') return;
  const doc = msg.document;
  if (doc) {
    const name = doc.file_name ?? 'книга';
    if (!FORMATS.includes(ext(name))) {
      await api(env, 'sendMessage', {
        chat_id,
        text: 'Такой формат пока не открывается. Пришлите EPUB, FB2, PDF или TXT.',
      });
      return;
    }
    if ((doc.file_size ?? 0) > DOWNLOAD_LIMIT) {
      await api(env, 'sendMessage', {
        chat_id,
        text:
          'Файл больше 20 МБ — Telegram не даёт ботам скачивать такие. ' +
          'Откройте приложение и добавьте книгу кнопкой «Добавить»: она прочитается на этом устройстве.',
        reply_markup: {
          inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: env.APP_URL } }]],
        },
      });
      return;
    }
    await api(env, 'sendMessage', {
      chat_id,
      reply_to_message_id: msg.message_id,
      text: `«${name}» в библиотеке. Можно читать.`,
      reply_markup: readButton(env, doc),
    });
    return;
  }
  await api(env, 'sendMessage', {
    chat_id,
    text: WELCOME,
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть библиотеку', web_app: { url: env.APP_URL } }]],
    },
  });
}

function cors(env: Env, res: Response) {
  const origin = new URL(env.APP_URL).origin;
  res.headers.set('access-control-allow-origin', origin);
  res.headers.set('access-control-allow-headers', 'authorization, content-type, x-file-name');
  res.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.headers.set('access-control-expose-headers', 'content-length');
  res.headers.set('vary', 'origin');
  return res;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function userOf(env: Env, req: Request): Promise<TgUser | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('tma ')) return null;
  return verifyInitData(auth.slice(4), env.BOT_TOKEN);
}

async function download(env: Env, fileId: string) {
  const file = await api<{ file_path?: string; file_size?: number }>(env, 'getFile', {
    file_id: fileId,
  });
  if (!file.file_path) return json({ error: 'too_big' }, 413);
  const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
  if (!res.ok || !res.body) return json({ error: 'telegram' }, 502);
  return new Response(res.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': res.headers.get('content-length') ?? String(file.file_size ?? ''),
      'cache-control': 'private, max-age=86400',
    },
  });
}

async function upload(env: Env, req: Request, user: TgUser) {
  const name = decodeURIComponent(req.headers.get('x-file-name') ?? 'book');
  if (!FORMATS.includes(ext(name))) return json({ error: 'format' }, 400);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > UPLOAD_LIMIT) return json({ error: 'too_big' }, 413);
  const form = new FormData();
  form.set('chat_id', String(user.id));
  form.set('caption', 'Добавлено из приложения. Отсюда книга откроется на любом устройстве.');
  form.set('document', new File([bytes], name));
  const msg = await api<TgMessage>(env, 'sendDocument', form);
  const doc = msg.document!;
  // Кнопка «Читать» под самим файлом.
  await api(env, 'editMessageReplyMarkup', {
    chat_id: user.id,
    message_id: msg.message_id,
    reply_markup: readButton(env, doc),
  }).catch(() => undefined);
  return json({ file_id: doc.file_id, uid: doc.file_unique_id, name });
}

async function setup(env: Env, origin: string) {
  await api(env, 'setWebhook', {
    url: `${origin}/bot`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message'],
  });
  await api(env, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Библиотека', web_app: { url: env.APP_URL } },
  });
  await api(env, 'setMyCommands', {
    commands: [{ command: 'start', description: 'Как пользоваться' }],
  });
  await api(env, 'setMyDescription', { description: DESCRIPTION });
  await api(env, 'setMyShortDescription', { short_description: SHORT_DESCRIPTION });
  return new Response('Готово: вебхук, кнопка меню и команды настроены.', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));

    if (url.pathname === '/bot' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET)
        return new Response('forbidden', { status: 403 });
      const update = (await req.json()) as { message?: TgMessage };
      // Отвечаем Telegram сразу, а сообщение обрабатываем после.
      if (update.message) ctx.waitUntil(handleMessage(env, update.message).catch(console.error));
      return new Response('ok');
    }

    if (url.pathname === '/setup') {
      if (url.searchParams.get('key') !== env.WEBHOOK_SECRET)
        return new Response('forbidden', { status: 403 });
      return setup(env, url.origin);
    }

    if (url.pathname === '/file' || url.pathname === '/upload') {
      const user = await userOf(env, req);
      if (!user) return cors(env, json({ error: 'auth' }, 401));
      try {
        if (url.pathname === '/file' && req.method === 'GET') {
          const id = url.searchParams.get('id');
          if (!id) return cors(env, json({ error: 'id' }, 400));
          return cors(env, await download(env, id));
        }
        if (url.pathname === '/upload' && req.method === 'POST')
          return cors(env, await upload(env, req, user));
      } catch (e) {
        return cors(env, json({ error: String((e as Error).message) }, 502));
      }
    }

    return new Response('telegramspeedreader', { status: url.pathname === '/' ? 200 : 404 });
  },
};
