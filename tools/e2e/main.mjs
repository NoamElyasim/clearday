// End-to-end check of the real renderer, driven with real input events
// (clicks, typing, ⌘ shortcuts, a pointer drag) against the real store, in a
// scratch user-data folder. Prints one line per check and exits non-zero if
// any fails.
//
//   npm run e2e
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSeed } from '../shots/seed.mjs';

const REPO = path.join(import.meta.dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-e2e-'));
process.env.CLEARDAY_USER_DATA = TMP;
writeSeed(TMP);
await import('../../src/main/paths.mjs');
const store = await import('../../src/main/store.mjs');
const settings = await import('../../src/main/settings.mjs');

let win;
ipcMain.handle('tasks:list', () => store.list());
ipcMain.handle('tasks:create', (_e, f) => store.create(f || {}));
ipcMain.handle('tasks:update', (_e, id, p) => store.update(id, p || {}));
ipcMain.handle('tasks:remove', (_e, id) => store.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => store.restore(id));
ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, p) => { settings.set(p || {}); win.webContents.send('settings', settings.all()); return settings.all(); });
ipcMain.handle('menu:sort', () => {});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataFile: '' }));
for (const ch of ['app:reveal-data', 'app:export', 'app:reset-bounds', 'app:quit']) ipcMain.handle(ch, () => null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

app.on('window-all-closed', () => {});
app.whenReady().then(run).catch((e) => { console.error(e); app.exit(1); });

async function run() {
  win = new BrowserWindow({
    width: 780, height: 560, show: true, x: 40, y: 40, frame: false, transparent: true,
    webPreferences: { preload: path.join(REPO, 'src', 'preload.cjs'), contextIsolation: true },
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log(`[renderer] ${e.message}`); });
  await win.loadFile(path.join(REPO, 'src', 'renderer', 'index.html'));
  await sleep(500);
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const rect = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();
    return r && { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: r.top, bottom: r.bottom, left: r.left }; })()`);
  async function click(sel, count = 1) {
    const r = await rect(sel);
    if (!r) throw new Error(`no element for ${sel}`);
    wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    for (let i = 1; i <= count; i++) {
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: i });
      wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: i });
    }
    await sleep(250);
  }
  async function key(keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    // Chromium acts on the char event for printable keys and Return.
    if (keyCode.length === 1 || keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(200);
  }
  async function type(text) {
    await wc.insertText(text);
    await sleep(150);
  }
  const task = (id) => store.list().find((t) => t.id === id);
  const byText = (text) => store.list().find((t) => t.text === text);
  const taskSel = (id) => `.task[data-id="${id}"]`;
  app.focus({ steal: true });
  win.focus();
  wc.focus();
  await sleep(200);

  // ── Add ──
  await click('#add-input');
  await type('Plan the sprint review');
  const typed = await js(`document.getElementById('add-input').value`);
  await key('Enter');
  let t = byText('Plan the sprint review');
  check('Enter adds a task to To Do', t?.status === 'todo' &&
    await js(`!!document.querySelector('[data-page="todo"] .list ${taskSel(t?.id)}')`), `typed "${typed}"`);
  if (!t) throw new Error('cannot continue without the new task');
  const id = t.id;

  // ── Status ──
  await click(`${taskSel(id)} .status-btn`);
  check('the status picker lists 5 statuses and Move to Ongoing', await js(`(() => {
    const items = [...document.querySelectorAll('.popover .pop-item')].map((b) => b.textContent);
    return items.length === 6 && items.some((t) => t.includes('Awaiting Approval')) && items[5].includes('Move to Ongoing'); })()`));
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('picking In Progress fills the row and moves it to the board',
    task(id).status === 'in_progress' &&
    await js(`!!document.querySelector('.section[data-status="in_progress"] ${taskSel(id)}')`) &&
    await js(`getComputedStyle(document.querySelector('${taskSel(id)} .row')).backgroundColor`) !== 'rgba(0, 0, 0, 0)');
  check('row text is white on the fill',
    await js(`getComputedStyle(document.querySelector('${taskSel(id)} .text')).color`) === 'rgb(255, 255, 255)');

  // ── Partial bold ──
  await js(`(() => {
    const el = document.querySelector('${taskSel(id)} .text');
    const n = el.firstChild; const r = document.createRange();
    r.setStart(n, 9); r.setEnd(n, 15);   // "sprint"
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  })()`);
  await key('B', ['meta']);
  check('⌘B bolds only the selected word', JSON.stringify(task(id).bold) === '[[9,15]]',
    JSON.stringify(task(id).bold));
  check('bold shows in the row', await js(`document.querySelector('${taskSel(id)} .text b')?.textContent`) === 'sprint');
  await js('getSelection().removeAllRanges()');
  await click(`${taskSel(id)} [data-action="bold"]`);
  check('B with no selection bolds the whole row', JSON.stringify(task(id).bold) === '[[0,22]]', JSON.stringify(task(id).bold));
  await click(`${taskSel(id)} [data-action="bold"]`);
  check('B again un-bolds the whole row', task(id).bold.length === 0);

  // ── Priority ──
  await click(`${taskSel(id)} [data-action="priority"]`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('High')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  check('High priority shows a red ring', task(id).priority === 'high' &&
    await js(`document.querySelector('${taskSel(id)} .ring').dataset.priority`) === 'high');

  // ── Edit, Esc cancels, Enter saves ──
  await click(`${taskSel(id)} [data-action="edit"]`);
  check('pencil makes the text editable', await js(`document.querySelector('${taskSel(id)} .text').isContentEditable`));
  await type(' XYZ');
  await key('Escape');
  check('Esc cancels the edit', task(id).text === 'Plan the sprint review' &&
    await js(`document.querySelector('${taskSel(id)} .text').textContent`) === 'Plan the sprint review');
  await click(`${taskSel(id)} .text`, 2);
  await type(' today');
  await key('Enter');
  check('double-click edits, Enter saves', task(id).text === 'Plan the sprint review today', task(id).text);

  // ── Notes ──
  await click(`${taskSel(id)} [data-action="notes"]`);
  check('≡ opens notes under the row', await js(`(() => {
    const row = document.querySelector('${taskSel(id)} .row').getBoundingClientRect();
    const n = document.querySelector('${taskSel(id)} .notes')?.getBoundingClientRect();
    return !!n && n.top >= row.bottom - 1; })()`));
  await type('Bring the burndown chart');
  await sleep(700);
  check('notes save automatically', task(id).notes === 'Bring the burndown chart');
  await key('Escape');
  check('Esc does not close notes', await js(`!!document.querySelector('${taskSel(id)} .notes')`));
  check('notes have no X button', await js(`!document.querySelector('${taskSel(id)} .notes button')`));
  await wc.executeJavaScript('0');
  win.webContents.send('notes:dir', { id, dir: 'rtl' });
  await sleep(300);
  check('Writing Direction sets the note right-to-left', task(id).notesDir === 'rtl' &&
    await js(`document.querySelector('${taskSel(id)} .notes textarea').dir`) === 'rtl');
  const grip = await rect(`${taskSel(id)} .notes-resize`);
  wc.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y });
  wc.sendInputEvent({ type: 'mouseDown', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { wc.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y + i * 8, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
  wc.sendInputEvent({ type: 'mouseUp', x: grip.x, y: grip.y + 64, button: 'left', clickCount: 1 });
  await sleep(300);
  check('dragging the bottom edge resizes notes', task(id).notesHeight >= 160 + 50, `height ${task(id).notesHeight}`);
  await click(`${taskSel(id)} [data-action="notes"]`);
  check('≡ again closes notes; ≡ shows a notes dot',
    await js(`!document.querySelector('${taskSel(id)} .notes') && document.querySelector('${taskSel(id)} .notes-btn').classList.contains('has-notes')`));

  // ── Delete and undo ──
  await click(`${taskSel(id)} .text`);
  await js('getSelection().removeAllRanges(); document.activeElement.blur()');
  await key('Backspace', ['meta']);
  await sleep(400);
  check('⌘⌫ deletes the selected task', !task(id) && await js(`!document.querySelector('${taskSel(id)}')`));
  check('an undo toast appears', await js(`!!document.querySelector('.toast button')`));
  await click('.toast button');
  await sleep(300);
  check('Undo restores it', !!task(id) && await js(`!!document.querySelector('${taskSel(id)}')`));

  // ── Drag and drop ──
  const ip = () => js(`[...document.querySelectorAll('.section[data-status="in_progress"] .task')].map((e) => e.dataset.id)`);
  const before = await ip();
  const first = before[0];
  const g = await rect(`${taskSel(first)} .grip`);
  const last = await rect(`${taskSel(before[before.length - 1])}`);
  wc.sendInputEvent({ type: 'mouseMove', x: g.x, y: g.y });
  wc.sendInputEvent({ type: 'mouseDown', x: g.x, y: g.y, button: 'left', clickCount: 1 });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    wc.sendInputEvent({ type: 'mouseMove', x: g.x, y: Math.round(g.y + (last.bottom + 4 - g.y) * i / steps), button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: g.x, y: Math.round(last.bottom + 4), button: 'left', clickCount: 1 });
  await sleep(500);
  const after = await ip();
  check('dragging a row reorders its section', after[after.length - 1] === first && after.length === before.length,
    `${before.length} rows`);
  const todoFirst = await js(`document.querySelector('[data-page="todo"] .task')?.dataset.id`);
  const tg = await rect(`${taskSel(todoFirst)} .grip`);
  wc.sendInputEvent({ type: 'mouseMove', x: tg.x, y: tg.y });
  wc.sendInputEvent({ type: 'mouseDown', x: tg.x, y: tg.y, button: 'left', clickCount: 1 });
  // Lift it first; the board shifts as the placeholder travels, so the target
  // is measured on the way rather than up front.
  wc.sendInputEvent({ type: 'mouseMove', x: tg.x - 10, y: tg.y + 10, button: 'left', modifiers: ['leftButtonDown'] });
  await sleep(50);
  let target = await rect('.section[data-status="on_hold"] .task .text');
  let px = tg.x - 10, py = tg.y + 10;
  for (let i = 1; i <= steps; i++) {
    if (i === steps / 2) target = await rect('.section[data-status="on_hold"] .task .text');
    px = Math.round(px + (target.x - px) / (steps - i + 1));
    py = Math.round(py + (target.y - py) / (steps - i + 1));
    wc.sendInputEvent({ type: 'mouseMove', x: px, y: py, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(500);
  check('dragging from To Do onto a board section changes its status', task(todoFirst).status === 'on_hold', task(todoFirst).status);

  // ── Awaiting Approval ──
  await click(`${taskSel(todoFirst)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Awaiting')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('Awaiting Approval moves a row to its own section, in light blue',
    task(todoFirst).status === 'awaiting_approval' &&
    await js(`!!document.querySelector('.section[data-status="awaiting_approval"] ${taskSel(todoFirst)}')`) &&
    await js(`getComputedStyle(document.querySelector('${taskSel(todoFirst)} .row')).backgroundColor`) === 'rgb(61, 155, 224)');

  // ── Ongoing ──
  await click('.side-tab[data-tab="ongoing"]');
  check('the Ongoing tab shows its list and is remembered',
    settings.get('sidePanel') === 'ongoing' && await js(`document.querySelector('[data-page="ongoing"]').classList.contains('active')`));
  await click('#add-input');
  await type('Website redesign');
  await key('Enter');
  const og = byText('Website redesign');
  check('adding with Ongoing showing puts the task in Ongoing', og?.list === 'ongoing' &&
    await js(`!!document.querySelector('[data-page="ongoing"] ${taskSel(og?.id)}')`));
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('an Ongoing task takes a status but stays off the board', task(og.id).status === 'in_progress' &&
    task(og.id).list === 'ongoing' && await js(`!document.querySelector('#sections ${taskSel(og.id)}')`));
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Move to Today')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('Move to Today puts it on the board, status kept', task(og.id).list === 'today' &&
    await js(`!!document.querySelector('.section[data-status="in_progress"] ${taskSel(og.id)}')`));
  await click('.side-tab[data-tab="todo"]');

  // ── Preferences ──
  await click('#settings-btn');
  await sleep(300);
  check('the gear opens Preferences', await js(`document.getElementById('prefs').classList.contains('open')`));
  await js(`(() => { const s = document.querySelectorAll('#prefs .slider')[1]; s.value = 40; s.dispatchEvent(new Event('input')); })()`);
  await sleep(300);
  check('the Dark opacity slider saves and updates the background', settings.get('bgOpacityDark') === 0.4 &&
    await js(`document.documentElement.style.getPropertyValue('--bg-opacity-dark')`) === '0.4');
  await key('Escape');
  await sleep(300);
  check('Esc closes Preferences', await js(`!document.getElementById('prefs').classList.contains('open')`));

  // ── Sort ──
  settings.set({ sort: 'priority' });
  wc.send('settings', settings.all());
  await sleep(500);
  const flat = await js(`[...document.querySelectorAll('#sections .task')].map((e) => e.dataset.id)`);
  const ranks = flat.map((i) => ({ high: 0, medium: 1 })[task(i).priority] ?? 2);
  check('priority sort lists the board high → medium → none',
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r) && await js(`document.querySelectorAll('.section-head').length`) === 0);
  settings.set({ sort: 'default' });
  wc.send('settings', settings.all());
  await sleep(300);

  // ── Persistence ──
  store.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(TMP, 'tasks.json'), 'utf8'));
  const saved = onDisk.tasks.find((x) => x.id === id);
  check('everything is on disk after a save',
    saved && saved.text === 'Plan the sprint review today' && saved.priority === 'high' && saved.notes === 'Bring the burndown chart' &&
    saved.status === 'in_progress' && saved.notesDir === 'rtl' && !saved.deletedAt && typeof saved.updatedAt === 'string');

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  fs.rmSync(TMP, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}
