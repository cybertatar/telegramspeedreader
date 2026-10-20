// Проверка initData мини-аппа: Telegram подписывает данные пользователя ключом,
// выведенным из токена бота. Без этого чужие запросы к файлам не отличить от своих.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Сколько живёт подпись: мини-апп получает новую при каждом открытии. */
export const MAX_AGE_S = 24 * 60 * 60;

export async function verifyInitData(
  initData: string,
  botToken: string,
  now = Date.now() / 1000,
): Promise<TgUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const expected = hex(await hmac(secret, check));
  if (expected !== hash) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || now - authDate > MAX_AGE_S) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '') as TgUser;
    return typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/** Для тестов: подписать initData так же, как это делает Telegram. */
export async function signInitData(fields: Record<string, string>, botToken: string) {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const hash = hex(await hmac(secret, check));
  return new URLSearchParams({ ...fields, hash }).toString();
}
