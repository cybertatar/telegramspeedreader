import { afterEach, describe, expect, it, vi } from 'vitest';
import { signInitData, verifyInitData } from './auth';
import worker, { handleMessage, readUrl, type Env } from './index';

const env: Env = {
  BOT_TOKEN: '123:ABC',
  WEBHOOK_SECRET: 's3cret',
  APP_URL: 'https://cybertatar.github.io/telegramspeedreader/',
};
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 42, first_name: 'Даниил' });

describe('verifyInitData', () => {
  it('принимает подпись Telegram и отдаёт пользователя', async () => {
    const data = await signInitData({ auth_date: String(now), user }, env.BOT_TOKEN);
    expect(await verifyInitData(data, env.BOT_TOKEN)).toMatchObject({ id: 42 });
  });

  it('отклоняет подделку, чужой токен и старую подпись', async () => {
    const data = await signInitData({ auth_date: String(now), user }, env.BOT_TOKEN);
    expect(await verifyInitData(data.replace('42', '43'), env.BOT_TOKEN)).toBeNull();
    expect(await verifyInitData(data, '999:XYZ')).toBeNull();
    const old = await signInitData({ auth_date: String(now - 3 * 86400), user }, env.BOT_TOKEN);
    expect(await verifyInitData(old, env.BOT_TOKEN)).toBeNull();
  });
});

describe('бот', () => {
  afterEach(() => vi.restoreAllMocks());

  const telegram = () => {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const method = String(input).split('/').pop()!;
      calls.push({ method, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: {} }));
    });
    return calls;
  };

  it('на книгу отвечает кнопкой «Читать» со ссылкой на файл', async () => {
    const calls = telegram();
    const doc = {
      file_id: 'FID',
      file_unique_id: 'UID',
      file_name: 'Pro Git.pdf',
      file_size: 1000,
    };
    await handleMessage(env, { message_id: 1, chat: { id: 42, type: 'private' }, document: doc });
    const btn = (calls[0].body.reply_markup as any).inline_keyboard[0][0];
    expect(btn.web_app.url).toBe(readUrl(env, doc));
    expect(btn.web_app.url).toContain('file=FID');
    expect(btn.web_app.url).toContain('uid=UID');
  });

  it('предупреждает о файлах больше 20 МБ и неизвестных форматах', async () => {
    const calls = telegram();
    const chat = { id: 42, type: 'private' };
    await handleMessage(env, {
      message_id: 1,
      chat,
      document: { file_id: 'F', file_unique_id: 'U', file_name: 'big.pdf', file_size: 30e6 },
    });
    await handleMessage(env, {
      message_id: 2,
      chat,
      document: { file_id: 'F', file_unique_id: 'U', file_name: 'book.djvu', file_size: 10 },
    });
    expect(calls[0].body.text).toMatch(/20 МБ/);
    expect(calls[1].body.text).toMatch(/формат/);
  });

  it('вебхук без секрета не принимает, файл без подписи не отдаёт', async () => {
    const hook = await worker.fetch(
      new Request('https://w.dev/bot', { method: 'POST', body: '{}' }),
      env,
      ctx,
    );
    expect(hook.status).toBe(403);
    const file = await worker.fetch(new Request('https://w.dev/file?id=F'), env, ctx);
    expect(file.status).toBe(401);
    expect(file.headers.get('access-control-allow-origin')).toBe('https://cybertatar.github.io');
  });
});
