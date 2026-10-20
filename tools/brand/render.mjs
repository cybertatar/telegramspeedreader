// Рисует картинки бота: `node tools/brand/render.mjs` (нужен Playwright с Chromium).
// Результат — docs/brand/avatar.png и docs/brand/description.png; загружаются в @BotFather.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(dir, '../../docs/brand');
const browser = await chromium.launch();
for (const [name, width, height] of [
  ['avatar', 1024, 1024],
  ['description', 640, 360],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`file://${dir}/${name}.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}
await browser.close();
