/**
 * Опорная буква (optimal recognition point): чуть левее середины слова.
 * Она подсвечивается и всегда стоит в одной точке экрана — глаз не прыгает.
 */
export function orpIndex(text: string): number {
  const lead = text.search(/[\p{L}\p{N}]/u);
  if (lead < 0) return 0;
  const core = text.slice(lead).match(/^[\p{L}\p{N}'’-]*/u)![0].length;
  const shift = core <= 1 ? 0 : core <= 5 ? 1 : core <= 9 ? 2 : core <= 13 ? 3 : 4;
  return lead + shift;
}
