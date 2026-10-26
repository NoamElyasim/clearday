// Line icons, drawn on a 16px grid to sit with SF text. Static strings only;
// nothing user-supplied ever goes through innerHTML.
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICONS = {
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  gear: svg('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/>'),
  sort: svg('<path d="M5 3v10M2.8 5.2 5 3l2.2 2.2M11 13V3M8.8 10.8 11 13l2.2-2.2"/>'),
  pencil: svg('<path d="M10.6 2.9a1.5 1.5 0 0 1 2.1 2.1L5.4 12.3l-2.9.8.8-2.9z"/><path d="m9.6 3.9 2.1 2.1"/>'),
  bold: svg('<path d="M4.5 2.8h4.1a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 8h4.8a2.6 2.6 0 0 1 0 5.2H4.5z" stroke-width="1.7"/>'),
  flag: svg('<path d="M3.5 14V2.5M3.5 3h7.8l-1.8 3 1.8 3H3.5"/>'),
  trash: svg('<path d="M2.8 4.3h10.4M6.4 4.3V2.8h3.2v1.5M4.2 4.3l.6 8.9h6.4l.6-8.9M6.7 6.8v4M9.3 6.8v4"/>'),
  notes: svg('<path d="M3 4.5h10M3 8h10M3 11.5h10"/>'),
  close: svg('<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>'),
  more: svg('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
  check: svg('<path d="m3.8 8.3 2.7 2.7 5.7-6"/>', ' stroke-width="2"'),
  grip: svg('<circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none"/>'),
};
