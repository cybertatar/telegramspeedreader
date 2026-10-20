// Связь с Worker'ом бота: скачать книгу из чата по file_id и сохранить книгу,
// добавленную в приложении, в чат — чтобы она была на всех устройствах.

import { initData, inTelegram } from './telegram';

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

/** Работает только внутри Telegram и когда при сборке указан адрес Worker'а. */
export const cloudEnabled = inTelegram && !!API;

const headers = () => ({ authorization: `tma ${initData}` });

export class CloudError extends Error {}

export async function downloadBook(fileId: string): Promise<Uint8Array> {
  if (!API) throw new CloudError('Бот не подключён');
  const res = await fetch(`${API}/file?id=${encodeURIComponent(fileId)}`, { headers: headers() });
  if (res.status === 413) throw new CloudError('Файл больше 20 МБ — Telegram не отдаёт его ботам');
  if (!res.ok) throw new CloudError(`Не удалось скачать книгу (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface Uploaded {
  file_id: string;
  uid: string;
}

export async function uploadBook(bytes: Uint8Array, name: string): Promise<Uploaded> {
  if (!API) throw new CloudError('Бот не подключён');
  const res = await fetch(`${API}/upload`, {
    method: 'POST',
    headers: { ...headers(), 'x-file-name': encodeURIComponent(name) },
    body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
  });
  if (!res.ok) throw new CloudError(`Не удалось сохранить книгу в чат (${res.status})`);
  return res.json();
}
