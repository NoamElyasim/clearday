// Draws the board: sections on the left, the To Do / Ongoing panel on the right, one
// element per task kept across renders (so focus, scroll and running
// animations survive) and moved with a FLIP animation when its place changes.
import { arrange, canDrag, STATUS_LABELS } from '../shared/model.mjs';
import { state } from './state.js';
import { renderRich } from './richtext.js';
import { ICONS } from './icons.js';

const MOVE_MS = 320;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const els = new Map();   // id → { el, sig }
let pane, sectionsEl, boardEl, sideEl, todoList, ongoingList;
let skeletonKey = '';
let notesHandlers = null;

export function initBoard(handlers) {
  pane = document.getElementById('pane');
  sectionsEl = document.getElementById('sections');
  boardEl = document.getElementById('board');
  sideEl = document.getElementById('side');
  todoList = sideEl.querySelector('[data-page="todo"] .list');
  ongoingList = sideEl.querySelector('[data-page="ongoing"] .list');
  notesHandlers = handlers;
}

export function taskEl(id) {
  return els.get(id)?.el || null;
}

export function textEl(id) {
  return taskEl(id)?.querySelector('.text') || null;
}

// ─── Row ─────────────────────────────────────────────────────────────────────
function button(cls, action, icon, title) {
  const b = document.createElement('button');
  b.className = cls;
  b.dataset.action = action;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  return b;
}

function createRow(task) {
  const el = document.createElement('div');
  el.className = 'task';
  el.dataset.id = task.id;

  const row = document.createElement('div');
  row.className = 'row';

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.title = 'Drag to reorder';
  grip.innerHTML = ICONS.grip;

  const status = button('status-btn', 'status', '', 'Set status');

  const text = document.createElement('div');
  text.className = 'text';
  text.spellcheck = false;

  const controls = document.createElement('div');
  controls.className = 'controls';
  const group = document.createElement('div');
  group.className = 'edit-group';
  group.append(
    button('ctl', 'edit', ICONS.pencil, 'Edit'),
    button('ctl', 'bold', ICONS.bold, 'Bold (⌘B)'),
    button('ctl', 'priority', ICONS.flag, 'Priority'),
    button('ctl', 'delete', ICONS.trash, 'Delete (⌘⌫)'),
  );
  const ringSlot = document.createElement('span');
  ringSlot.className = 'ring-slot';
  const ring = document.createElement('span');
  ring.className = 'ring';
  ringSlot.append(ring);
  controls.append(
    group,
    button('ctl more', 'more', ICONS.more, 'More'),
    ringSlot,
    button('ctl notes-btn', 'notes', ICONS.notes, 'Notes'),
  );

  row.append(grip, status, text, controls);
  el.append(row);
  return el;
}

function createNotes(task) {
  const n = document.createElement('div');
  n.className = 'notes';
  // Closed with the ≡ button that opened it; there is no close button here.
  const label = Object.assign(document.createElement('span'), { className: 'notes-label', textContent: 'Notes' });
  const ta = document.createElement('textarea');
  ta.placeholder = 'Write notes for this task…';
  ta.value = task.notes;
  ta.addEventListener('input', () => notesHandlers.onNotesInput(task.id, ta.value));
  const grip = document.createElement('div');
  grip.className = 'notes-resize';
  grip.title = 'Drag to resize';
  grip.addEventListener('pointerdown', (e) => startNotesResize(e, task.id, n));
  n.append(label, ta, grip);
  return n;
}

// Bottom edge / corner drag. The height is saved once, on release.
function startNotesResize(e, id, notesEl) {
  if (e.button !== 0) return;
  e.preventDefault();
  const startY = e.clientY;
  const startH = notesEl.offsetHeight;
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const move = (ev) => {
    notesEl.style.height = `${Math.max(72, Math.min(800, startH + ev.clientY - startY))}px`;
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    notesHandlers.onNotesResize(id, notesEl.offsetHeight);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}

function signature(task) {
  return [
    task.updatedAt, task.text, JSON.stringify(task.bold), task.status, task.priority,
    task.notes.length > 0, task.notesHeight, task.notesDir, state.spellcheck,
    state.selectedId === task.id, state.editingId === task.id, state.openNotes.has(task.id),
  ].join('|');
}

function rowFor(task) {
  let rec = els.get(task.id);
  if (!rec) {
    rec = { el: createRow(task), sig: '' };
    els.set(task.id, rec);
  }
  const sig = signature(task);
  if (sig === rec.sig) return rec.el;
  rec.sig = sig;

  const { el } = rec;
  el.dataset.status = task.status;
  const row = el.querySelector('.row');
  row.classList.toggle('selected', state.selectedId === task.id);

  const status = row.querySelector('.status-btn');
  status.innerHTML = task.status === 'done' ? ICONS.check : '';
  status.title = `Status: ${STATUS_LABELS[task.status]}`;

  // The row being edited owns its own text until the edit ends.
  if (state.editingId !== task.id) renderRich(row.querySelector('.text'), task.text, task.bold);

  const ring = row.querySelector('.ring');
  if (task.priority) ring.dataset.priority = task.priority;
  else delete ring.dataset.priority;
  ring.title = task.priority ? `${task.priority === 'high' ? 'High' : 'Medium'} priority` : '';

  const notesBtn = row.querySelector('.notes-btn');
  notesBtn.classList.toggle('has-notes', task.notes.trim().length > 0);

  // Notes panel, attached under the row
  const open = state.openNotes.has(task.id);
  let notes = el.querySelector('.notes');
  el.classList.toggle('notes-open', open);
  if (open && !notes) {
    notes = createNotes(task);
    el.append(notes);
  } else if (!open && notes) {
    notes.remove();
    notes = null;
  }
  if (notes) {
    notes.style.height = `${task.notesHeight}px`;
    const ta = notes.querySelector('textarea');
    ta.dir = task.notesDir || 'auto';
    ta.spellcheck = state.spellcheck;
    if (document.activeElement !== ta && ta.value !== task.notes) ta.value = task.notes;
  }
  return el;
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function ensureSkeleton(sections) {
  const key = sections.map((s) => s.status ?? 'flat').join(',');
  if (key === skeletonKey) return;
  skeletonKey = key;
  sectionsEl.replaceChildren(...sections.map((s) => {
    const sec = document.createElement('div');
    sec.className = 'section';
    const list = document.createElement('div');
    list.className = 'list';
    list.dataset.list = 'today';
    list.dataset.status = s.status ?? '';
    if (s.status) {
      sec.dataset.status = s.status;
      const head = document.createElement('div');
      head.className = 'section-head';
      head.append(
        Object.assign(document.createElement('span'), { className: 'dot' }),
        Object.assign(document.createElement('span'), { className: 'title', textContent: STATUS_LABELS[s.status] }),
        Object.assign(document.createElement('span'), { className: 'count' }),
      );
      sec.append(head);
    }
    sec.append(list);
    return sec;
  }));
}

// Puts exactly `tasks` into `list`, in order, moving only what is out of place
// (moving a node blurs whatever is focused inside it).
function reconcile(list, tasks) {
  tasks.forEach((task, i) => {
    const el = rowFor(task);
    const at = list.children[i];
    if (at !== el) list.insertBefore(el, at || null);
  });
  while (list.children.length > tasks.length) list.lastElementChild.remove();
}

function snapshot() {
  const rects = new Map();
  for (const [id, { el }] of els) if (el.isConnected) rects.set(id, el.getBoundingClientRect());
  return rects;
}

function play(before) {
  for (const [id, { el }] of els) {
    if (!el.isConnected) continue;
    const old = before.get(id);
    if (!old) {
      el.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, easing: EASE });
      continue;
    }
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left, dy = old.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: MOVE_MS, easing: EASE });
  }
}

export function render({ animate = false } = {}) {
  const before = animate ? snapshot() : null;
  const { todo, sections, ongoing } = arrange([...state.tasks.values()], state.sort);

  pane.classList.toggle('can-drag', canDrag(state.sort));
  ensureSkeleton(sections);
  const secEls = sectionsEl.children;
  sections.forEach((s, i) => {
    const sec = secEls[i];
    reconcile(sec.querySelector('.list'), s.tasks);
    sec.classList.toggle('is-empty', s.tasks.length === 0);
    const count = sec.querySelector('.count');
    if (count) count.textContent = s.tasks.length;
  });
  reconcile(todoList, todo);
  reconcile(ongoingList, ongoing);

  const boardCount = sections.reduce((n, s) => n + s.tasks.length, 0);
  boardEl.classList.toggle('is-empty', boardCount === 0);
  const counts = { todo: todo.length, ongoing: ongoing.length };
  for (const tab of ['todo', 'ongoing']) {
    sideEl.querySelector(`[data-page="${tab}"]`).classList.toggle('is-empty', counts[tab] === 0);
    for (const c of pane.querySelectorAll(`[data-tab="${tab}"] .count`)) c.textContent = counts[tab];
  }
  showSide(state.side);

  for (const [id, { el }] of els) {
    if (!state.tasks.has(id)) { el.remove(); els.delete(id); }
  }
  if (before) play(before);
}

// Which side tab is showing: 'todo' or 'ongoing'.
export function showSide(tab) {
  for (const el of sideEl.querySelectorAll('.side-tab')) el.classList.toggle('active', el.dataset.tab === tab);
  for (const el of sideEl.querySelectorAll('.side-page')) el.classList.toggle('active', el.dataset.page === tab);
}

// Tasks in the order they appear on screen, for ↑/↓.
export function visibleOrder() {
  const lists = [...sectionsEl.querySelectorAll('.list')];
  if (!state.compact || pane.classList.contains('drawer-open')) lists.push(state.side === 'ongoing' ? ongoingList : todoList);
  return lists.flatMap((l) => [...l.children].map((c) => c.dataset.id).filter(Boolean));
}
