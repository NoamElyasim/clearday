// Preferences: a sheet over the window, opened from the gear, ⌘, or the tray.
// Every control writes through clearday.settings.set(); the main process
// validates and applies the change and broadcasts the new settings, which
// come back through updatePrefs() — so the sheet always shows what is saved.
import { SORTS, SORT_LABELS } from '../shared/model.mjs';

const api = window.clearday;
let root = null;
let current = {};
const syncers = [];   // (settings) => void, one per control

const SHORTCUTS = [
  ['Enter', 'Add the task you typed; on a selected row, edit it'],
  ['⌘N', 'Jump to the add field'],
  ['↑ / ↓', 'Select a row'],
  ['⌘B', 'Bold the selection, or the whole row'],
  ['⌘⌫', 'Delete the selected task'],
  ['⌘Z', 'Undo the last delete'],
  ['⌘,', 'Preferences'],
  ['Esc', 'Cancel an edit, close a picker, the drawer or this sheet'],
];

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null));
  return el;
};
const set = (patch) => api.settings.set(patch);

function row(label, control, hint) {
  return h('div', { className: 'pref-row' },
    h('div', { className: 'pref-label' }, label, hint ? h('span', { className: 'pref-hint', textContent: hint }) : null),
    control);
}

function segmented(key, options) {
  const wrap = h('div', { className: 'seg', role: 'radiogroup' });
  const buttons = options.map(([value, label]) => {
    const b = h('button', { className: 'seg-btn', textContent: label, type: 'button' });
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => set({ [key]: value }));
    wrap.append(b);
    return [value, b];
  });
  syncers.push((s) => buttons.forEach(([value, b]) => {
    b.classList.toggle('active', s[key] === value);
    b.setAttribute('aria-checked', String(s[key] === value));
  }));
  return wrap;
}

function toggle(key, label) {
  const b = h('button', { className: 'switch', type: 'button' }, h('span', { className: 'knob' }));
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => set({ [key]: !current[key] }));
  syncers.push((s) => {
    b.classList.toggle('on', !!s[key]);
    b.setAttribute('aria-checked', String(!!s[key]));
  });
  return b;
}

// 0–100 % slider for a 0–1 setting. Writes as it moves, so the window
// background previews live.
function percent(key, label) {
  const input = h('input', { type: 'range', min: 0, max: 100, step: 1, className: 'slider' });
  input.setAttribute('aria-label', label);
  const out = h('output', { className: 'slider-value' });
  input.addEventListener('input', () => {
    out.textContent = `${input.value}%`;
    set({ [key]: Number(input.value) / 100 });
  });
  syncers.push((s) => {
    const v = Math.round((s[key] ?? 0) * 100);
    if (document.activeElement !== input) input.value = v;
    out.textContent = `${v}%`;
  });
  return h('div', { className: 'slider-wrap' }, input, out);
}

function select(key, options, label) {
  const sel = h('select', { className: 'pref-select' });
  sel.setAttribute('aria-label', label);
  for (const [value, text] of options) sel.append(h('option', { value, textContent: text }));
  sel.addEventListener('change', () => set({ [key]: sel.value }));
  syncers.push((s) => { sel.value = s[key]; });
  return sel;
}

function action(label, fn, cls = '') {
  const b = h('button', { className: `pref-action ${cls}`, textContent: label, type: 'button' });
  b.addEventListener('click', fn);
  return b;
}

function build(info) {
  const done = h('button', { className: 'prefs-done', textContent: 'Done', type: 'button' });
  done.addEventListener('click', closePrefs);
  const exportNote = h('span', { className: 'pref-hint export-note' });

  const sheet = h('div', { className: 'prefs-sheet' },
    h('header', { className: 'prefs-head' }, h('h2', { textContent: 'Preferences' }), done),
    h('div', { className: 'prefs-body' },
      h('section', {},
        h('h3', { textContent: 'Appearance' }),
        row('Theme', segmented('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])),
        row('Background opacity', percent('bgOpacityLight', 'Background opacity in Light mode'), 'Light mode'),
        row('Background opacity', percent('bgOpacityDark', 'Background opacity in Dark mode'), 'Dark mode'),
        row('Blur behind window', toggle('blur', 'Blur behind window')),
        row('Text size', segmented('textSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])),
        row('Show weekday', toggle('showWeekday', 'Show weekday')),
      ),
      h('section', {},
        h('h3', { textContent: 'Behavior' }),
        row('Always on top', toggle('alwaysOnTop', 'Always on top')),
        row('Show in', segmented('showIn', [['dock', 'Dock'], ['menubar', 'Menu bar only']])),
        row('Launch at login', toggle('openAtLogin', 'Launch at login')),
        row('Sort', select('sort', SORTS.map((s) => [s, SORT_LABELS[s]]), 'Sort')),
        row('Check spelling in notes', toggle('spellcheckNotes', 'Check spelling in notes')),
      ),
      h('section', {},
        h('h3', { textContent: 'Data' }),
        h('div', { className: 'pref-actions' },
          action('Show data folder', () => api.app.revealData()),
          action('Export tasks…', async () => {
            const file = await api.app.exportTasks();
            exportNote.textContent = file ? `Saved to ${file.split('/').pop()}` : '';
          }),
          action('Reset window position', () => api.app.resetBounds()),
        ),
        exportNote,
      ),
      h('section', {},
        h('h3', { textContent: 'Keyboard' }),
        h('dl', { className: 'shortcuts' },
          ...SHORTCUTS.flatMap(([k, d]) => [h('dt', {}, h('kbd', { textContent: k })), h('dd', { textContent: d })])),
      ),
      h('section', { className: 'about' },
        h('h3', { textContent: 'About' }),
        h('p', { textContent: `ClearDay ${info.version}` }),
        action('Quit ClearDay', () => api.app.quit(), 'danger'),
      ),
    ),
  );
  root.replaceChildren(h('div', { className: 'prefs-scrim' }), sheet);
  root.querySelector('.prefs-scrim').addEventListener('click', closePrefs);
}

export async function initPrefs(settings) {
  root = document.getElementById('prefs');
  build(await api.app.info());
  updatePrefs(settings);
  api.onPrefsOpen(openPrefs);
}

export function updatePrefs(settings) {
  current = settings;
  for (const sync of syncers) sync(settings);
}

export function isPrefsOpen() {
  return root?.classList.contains('open');
}

export function openPrefs() {
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
  root.querySelector('.prefs-done').focus({ preventScroll: true });
}

export function closePrefs() {
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  document.activeElement?.blur();
}
