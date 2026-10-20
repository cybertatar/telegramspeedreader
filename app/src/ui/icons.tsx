const icon = (d: string) => () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

export const IconBack = icon('M15 5l-7 7 7 7');
export const IconToc = icon('M4 6h16M4 12h10M4 18h13');
export const IconSettings = icon('M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4');
export const IconClose = icon('M6 6l12 12M18 6L6 18');
export const IconPlus = icon('M12 5v14M5 12h14');
export const IconMinus = icon('M5 12h14');
export const IconImage = icon('M4 5h16v14H4zM4 15l5-5 4 4 2-2 5 5M15 9h.01');
export const IconCode = icon('M9 8l-4 4 4 4M15 8l4 4-4 4');
export const IconTable = icon('M4 5h16v14H4zM4 10h16M10 10v9');
export const IconTrash = icon('M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3');
