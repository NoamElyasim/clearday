// Boot and behaviour: date header, layout, side tabs, adding, editing, bold,
// pickers, notes, delete with undo, drag and drop, preferences, and the
// keyboard.
import {
  STATUSES, STATUS_LABELS, PRIORITIES, toggleBold, trimRich, orderBetween, arrange,
} from '../shared/model.mjs';
import { state, load, changed, onChange, createTask, updateTask, removeTask, restoreTask } from './state.js';
import { initBoard, render, taskEl, textEl, visibleOrder, showSide } from './board.js';
import { renderRich, serialize, selectionOffsets, setSelection, caretToEnd } from './richtext.js';
import { openPopover, closePopover, handlePopoverKey, isOpen as popoverOpen } from './popover.js';
import { showToast } from './toast.js';
import { initDnd } from './dnd.js';
import { initPrefs, updatePrefs, openPrefs, closePrefs, isPrefsOpen } from './prefs.js';
import { ICONS } from './icons.js';

const api = window.clearday;
const pane = document.getElementById('pane');
const addForm = document.getElementById('add');
const addInput = document.getElementById('add-input');
const COMPACT_BELOW = 620;   // window width, px
const NOTES_SAVE_MS = 400;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const STATUS_VAR = {
  todo: '--status-todo', in_progress: '--status-in-progress', awaiting_approval: '--status-awaiting',
  on_hold: '--status-on-hold', done: '--status-done',
};

// ─── Date header ─────────────────────────────────────────────────────────────
// A test harness can shift the clock (window.cleardayClockOffset, ms) to check
// the midnight rollover without waiting for it.
const now = () => new Date(Date.now() + (window.cleardayClockOffset || 0));
const pad = (n) => String(n).padStart(2, '0');
let midnightTimer = null;

function updateDate() {
  const d = now();
  document.getElementById('date').textContent = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  document.getElementById('weekday').textContent = d.toLocaleDateString('en-GB', { weekday: 'long' });
  // Re-armed every time: after sleep, a long timer may have fired late or not
  // at all, so the next one is always measured from the clock as it is now.
  clearTimeout(midnightTimer);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  midnightTimer = setTimeout(updateDate, next - d + 50);
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function setCompact(compact) {
  if (compact === state.compact) return;
  const apply = () => {
    state.compact = compact;
    pane.classList.toggle('compact', compact);
    if (!compact) pane.classList.remove('drawer-open');
  };
  if (document.startViewTransition && !pane.classList.contains('instant')) document.startViewTransition(apply);
  else apply();
}
new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < COMPACT_BELOW)).observe(pane);

function setDrawer(open) {
  pane.classList.toggle('drawer-open', open && state.compact);
}

// ─── Side tabs: To Do | Ongoing ──────────────────────────────────────────────
// The tab showing also decides where the add field puts a new task.
function setSide(tab, { save = true } = {}) {
  if (tab !== 'todo' && tab !== 'ongoing') return;
  state.side = tab;
  showSide(tab);
  addInput.placeholder = tab === 'ongoing' ? 'Add an ongoing task…' : 'Add a task…';
  if (save) api.settings.set({ sidePanel: tab });
}

// ─── Adding ──────────────────────────────────────────────────────────────────
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = addInput.value.trim();
  if (!text) return;
  addInput.value = '';
  await createTask({ text, status: 'todo', list: state.side === 'ongoing' ? 'ongoing' : 'today' });
  render({ animate: true });
  if (state.compact && !pane.classList.contains('drawer-open')) {
    const tab = pane.querySelector(`.edge-tab[data-tab="${state.side}"]`);
    tab.classList.remove('bump');
    void tab.offsetWidth;
    tab.classList.add('bump');
  }
});

// ─── Editing ─────────────────────────────────────────────────────────────────
let editOriginal = null;

function startEdit(id) {
  if (state.editingId === id) return;
  if (state.editingId) commitEdit();
  const el = textEl(id);
  const task = state.tasks.get(id);
  if (!el || !task) return;
  state.editingId = id;
  state.selectedId = id;
  editOriginal = { text: task.text, bold: task.bold };
  render();
  el.contentEditable = 'true';
  el.focus();
  caretToEnd(el);
}

async function commitEdit() {
  const id = state.editingId;
  if (!id) return;
  const el = textEl(id);
  const raw = el ? serialize(el) : null;
  const next = raw ? trimRich(raw.text, raw.bold) : null;
  endEdit(el);
  const task = state.tasks.get(id);
  if (!task || !next || !next.text) { render(); return; }   // emptied: keep the old text
  if (next.text !== task.text || JSON.stringify(next.bold) !== JSON.stringify(task.bold)) {
    await updateTask(id, next);
  }
  render();
}

function cancelEdit() {
  const id = state.editingId;
  if (!id) return;
  const el = textEl(id);
  endEdit(el);
  if (el && editOriginal) renderRich(el, editOriginal.text, editOriginal.bold);
  render();
}

function endEdit(el) {
  state.editingId = null;
  if (el) {
    el.contentEditable = 'false';
    el.removeAttribute('contenteditable');
  }
  window.getSelection()?.removeAllRanges();
}

pane.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('.text[contenteditable="true"]')) return;
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
});
pane.addEventListener('focusout', (e) => {
  if (e.target.matches?.('.text[contenteditable="true"]')) commitEdit();
});
// Pasted text arrives plain, on one line.
pane.addEventListener('paste', (e) => {
  if (!e.target.closest?.('.text[contenteditable="true"]')) return;
  e.preventDefault();
  const text = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
  document.execCommand('insertText', false, text);
});
pane.addEventListener('dblclick', (e) => {
  const t = e.target.closest('.text');
  if (t && !t.isContentEditable) startEdit(t.closest('.task').dataset.id);
});

// ─── Bold ────────────────────────────────────────────────────────────────────
// Bolds the selected characters, or toggles the whole row when nothing in it
// is selected. In edit mode it works on the live text, saved with the edit.
async function toggleBoldFor(id) {
  const el = textEl(id);
  const task = state.tasks.get(id);
  if (!el || !task) return;
  const sel = selectionOffsets(el);
  const hasRange = sel && !sel.collapsed;

  if (state.editingId === id) {
    const cur = serialize(el);
    const len = cur.text.length;
    const [s, e] = hasRange ? [sel.start, sel.end] : [0, len];
    renderRich(el, cur.text, toggleBold(cur.bold, s, e, len));
    if (hasRange) setSelection(el, s, e); else caretToEnd(el);
    return;
  }

  const len = task.text.length;
  const [s, e] = hasRange ? [sel.start, sel.end] : [0, len];
  await updateTask(id, { bold: toggleBold(task.bold, s, e, len) });
  render();
  if (hasRange) setSelection(textEl(id), s, e);
}

// The row ⌘B acts on: where the text selection is, else the row being
// edited, else the selected row.
function boldTarget() {
  if (state.editingId) return state.editingId;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const node = sel.anchorNode?.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode?.parentElement;
    const t = node?.closest?.('.text');
    if (t) return t.closest('.task').dataset.id;
  }
  return state.selectedId;
}

// ─── Status, priority, "…" ───────────────────────────────────────────────────
async function setStatus(id, status) {
  const task = state.tasks.get(id);
  if (!task || task.status === status) return;
  await updateTask(id, { status });
  render({ animate: true });
}

async function setPriority(id, priority) {
  await updateTask(id, { priority });
  render();
}

// Today ↔ Ongoing, keeping the status.
async function moveList(id, list) {
  const t = await updateTask(id, { list });
  if (!t) return;
  render({ animate: true });
  showToast(list === 'ongoing' ? 'Moved to Ongoing' : 'Moved to Today', { duration: 2500 });
}

function moveItem(task) {
  return task.list === 'ongoing'
    ? { label: 'Move to Today', icon: ICONS.sort, onPick: () => moveList(task.id, 'today') }
    : { label: 'Move to Ongoing', icon: ICONS.sort, onPick: () => moveList(task.id, 'ongoing') };
}

function statusItems(task) {
  return [
    ...STATUSES.map((s) => ({
      label: STATUS_LABELS[s],
      swatch: { color: css(STATUS_VAR[s]), kind: 'fill' },
      checked: task.status === s,
      onPick: () => setStatus(task.id, s),
    })),
    { sep: true },
    moveItem(task),
  ];
}

function priorityItems(task) {
  return [...PRIORITIES].reverse().map((p) => ({
    label: p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'None',
    swatch: p ? { color: css(p === 'high' ? '--priority-high' : '--priority-medium'), kind: 'ring' } : { kind: 'none' },
    checked: task.priority === p,
    onPick: () => setPriority(task.id, p),
  }));
}

function moreItems(task) {
  return [
    { label: 'Edit', icon: ICONS.pencil, onPick: () => startEdit(task.id) },
    { label: 'Bold', icon: ICONS.bold, onPick: () => toggleBoldFor(task.id) },
    { sep: true },
    { heading: 'Priority' },
    ...priorityItems(task),
    { sep: true },
    moveItem(task),
    { label: 'Delete', icon: ICONS.trash, danger: true, onPick: () => deleteTask(task.id) },
  ];
}

// ─── Notes ───────────────────────────────────────────────────────────────────
const noteTimers = new Map();
const notesHandlers = {
  onNotesInput(id, value) {
    clearTimeout(noteTimers.get(id));
    noteTimers.set(id, setTimeout(async () => {
      noteTimers.delete(id);
      await updateTask(id, { notes: value });
      render();
    }, NOTES_SAVE_MS));
  },
  async onNotesResize(id, height) {
    await updateTask(id, { notesHeight: height });
    render();
  },
};

// ≡ opens the notes under the row, and closes them again.
function toggleNotes(id) {
  if (state.openNotes.has(id)) return closeNotes(id);
  state.openNotes.add(id);
  render({ animate: true });
  taskEl(id)?.querySelector('.notes textarea')?.focus();
}

function closeNotes(id) {
  // A note closed mid-typing still saves what was typed.
  const ta = taskEl(id)?.querySelector('.notes textarea');
  if (ta && noteTimers.has(id)) {
    clearTimeout(noteTimers.get(id));
    noteTimers.delete(id);
    updateTask(id, { notes: ta.value });
  }
  state.openNotes.delete(id);
  render({ animate: true });
}

// Writing Direction, chosen from a note's right-click menu (main.mjs).
api.onNotesDir(async ({ id, dir }) => {
  if (!state.tasks.has(id)) return;
  await updateTask(id, { notesDir: dir });
  render();
});

// Tells the right-click menu what was clicked: a note (and whose), a row's
// text being edited, the add field, or nothing editable.
document.addEventListener('contextmenu', (e) => {
  const ta = e.target.closest?.('.notes textarea');
  const id = e.target.closest?.('.task')?.dataset.id || null;
  window.cleardayContext = ta
    ? { field: 'notes', taskId: id, notesDir: state.tasks.get(id)?.notesDir || 'auto' }
    : e.target.closest?.('.text[contenteditable="true"]') ? { field: 'text', taskId: id }
    : e.target.matches?.('input, textarea') ? { field: 'input' }
    : { field: null };
}, true);

// ─── Delete and undo ─────────────────────────────────────────────────────────
const deleted = [];   // ids, most recent last, for ⌘Z

async function deleteTask(id) {
  if (state.editingId === id) cancelEdit();
  const el = taskEl(id);
  if (el) {
    await el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
      { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
  }
  await removeTask(id);
  render({ animate: true });
  deleted.push(id);
  showToast('Task deleted', { action: 'Undo', onAction: () => undoDelete(id) });
}

async function undoDelete(id = deleted[deleted.length - 1]) {
  if (!id) return;
  const i = deleted.lastIndexOf(id);
  if (i >= 0) deleted.splice(i, 1);
  const t = await restoreTask(id);
  if (t) render({ animate: true });
}

// ─── Clicks ──────────────────────────────────────────────────────────────────
// Buttons keep the text selection: the B button has to see what was selected.
pane.addEventListener('mousedown', (e) => {
  if (e.target.closest('.ctl, .status-btn')) e.preventDefault();
});

pane.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  const taskNode = e.target.closest('.task');
  const id = taskNode?.dataset.id;
  const task = id && state.tasks.get(id);

  if (btn && task) {
    const action = btn.dataset.action;
    select(id);
    if (action === 'status') openPopover(btn, statusItems(task));
    else if (action === 'priority') openPopover(btn, priorityItems(task));
    else if (action === 'more') openPopover(btn, moreItems(task));
    else if (action === 'edit') startEdit(id);
    else if (action === 'bold') toggleBoldFor(id);
    else if (action === 'delete') deleteTask(id);
    else if (action === 'notes') toggleNotes(id);
    return;
  }
  const sideTab = e.target.closest('.side-tab');
  if (sideTab) { setSide(sideTab.dataset.tab); return; }
  const edgeTab = e.target.closest('.edge-tab');
  if (edgeTab) { setSide(edgeTab.dataset.tab); setDrawer(true); return; }
  if (taskNode && e.target.closest('.row')) { select(id); return; }
  if (e.target.closest('.notes')) return;
  // Empty space: deselect, and close the compact drawer when clicking past it.
  if (!e.target.closest('#side')) setDrawer(false);
  if (!taskNode) select(null);
});

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  render();
}

document.getElementById('sort-btn').addEventListener('click', () => api.menus.sort());
document.getElementById('settings-btn').addEventListener('click', () => (isPrefsOpen() ? closePrefs() : openPrefs()));
document.getElementById('sort-btn').innerHTML = ICONS.sort;
document.getElementById('settings-btn').innerHTML = ICONS.gear;
document.getElementById('add-btn').innerHTML = ICONS.plus;

// ─── Drag and drop ───────────────────────────────────────────────────────────
initDnd(pane, {
  async onDrop(id, { list, listStatus, prevId, nextId }) {
    const task = state.tasks.get(id);
    if (!task) return;
    // Onto Ongoing: the task keeps its status. Onto Today: To Do and each
    // board section set their status; '' is the single board list of the
    // non-default sorts, where a task arriving from To Do starts In Progress
    // and any other keeps its status.
    const status = list === 'ongoing' ? task.status
      : listStatus || (task.status === 'todo' ? 'in_progress' : task.status);
    const order = orderBetween(state.tasks.get(prevId)?.order ?? null, state.tasks.get(nextId)?.order ?? null);
    await updateTask(id, { list: list === 'ongoing' ? 'ongoing' : 'today', status, order });
    render({ animate: true });
  },
  onHoverTab: (tab) => setSide(tab),
});

// ─── Keyboard ────────────────────────────────────────────────────────────────
const typing = (t) => t && (t.matches?.('input, textarea') || t.isContentEditable);

window.addEventListener('keydown', (e) => {
  if (handlePopoverKey(e)) { e.preventDefault(); return; }
  const cmd = e.metaKey && !e.ctrlKey && !e.altKey;

  if (cmd && e.key.toLowerCase() === 'b') {
    const id = boldTarget();
    if (id) { e.preventDefault(); toggleBoldFor(id); }
    return;
  }
  if (cmd && e.key === ',') {
    e.preventDefault();
    if (isPrefsOpen()) closePrefs(); else openPrefs();
    return;
  }
  if (cmd && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    addInput.focus();
    return;
  }
  if (e.key === 'Escape') {
    if (isPrefsOpen()) { closePrefs(); return; }
    if (state.editingId) { cancelEdit(); return; }
    if (document.activeElement === addInput) { addInput.value = ''; addInput.blur(); return; }
    if (pane.classList.contains('drawer-open')) { setDrawer(false); return; }
    select(null);
    return;
  }
  if (typing(e.target) || isPrefsOpen()) return;

  if (cmd && (e.key === 'Backspace' || e.key === 'Delete')) {
    if (state.selectedId) { e.preventDefault(); deleteTask(state.selectedId); }
    return;
  }
  if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey && deleted.length) {
    e.preventDefault();
    undoDelete();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const order = visibleOrder();
    if (!order.length) return;
    const i = order.indexOf(state.selectedId);
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : order.length - 1)
      : Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    select(order[next]);
    taskEl(order[next])?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (e.key === 'Enter' && state.selectedId) {
    e.preventDefault();
    startEdit(state.selectedId);
  }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
onChange((opts) => render(opts));

async function boot() {
  initBoard(notesHandlers);
  updateDate();
  api.onClockResume(updateDate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDate(); });

  const s = await api.settings.get();
  applySettings(s, { first: true });
  api.settings.onChange((next) => applySettings(next));

  await load();
  setCompact(pane.clientWidth < COMPACT_BELOW);
  render();
  await initPrefs(s);
  // Transitions on only after the first paint, so nothing animates in.
  requestAnimationFrame(() => requestAnimationFrame(() => pane.classList.remove('instant')));
}

// Settings the window shows directly. Text size is applied by the main
// process as the page zoom.
function applySettings(s, { first = false } = {}) {
  const root = document.documentElement.style;
  root.setProperty('--bg-opacity-light', String(s.bgOpacityLight));
  root.setProperty('--bg-opacity-dark', String(s.bgOpacityDark));
  document.getElementById('weekday').hidden = !s.showWeekday;

  const sortChanged = s.sort !== state.sort;
  const spellChanged = s.spellcheckNotes !== state.spellcheck;
  state.sort = s.sort;
  state.spellcheck = s.spellcheckNotes;
  if (s.sidePanel !== state.side || first) setSide(s.sidePanel, { save: false });
  if (!first) {
    updatePrefs(s);
    if (sortChanged) render({ animate: true });
    else if (spellChanged) render();
  }
}

boot();

// For the screenshot harness and debugging from the console.
window.cleardayDebug = {
  state, updateDate, render, changed, arrange, toggleNotes, startEdit, toggleBoldFor, setDrawer, setSide,
  openPrefs, closePrefs, popoverOpen, closePopover,
};
