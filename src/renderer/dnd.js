// Drag and drop by the row's grip. Pointer events rather than HTML5 drag, so
// the lifted row follows the pointer smoothly and siblings can slide aside.
// Dropping between the To Do panel and the board changes status; dropping on
// a board section takes that section's status; dropping on the Ongoing list
// moves the task there. Hovering a side tab mid-drag switches to it.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const START_PX = 4;

let drag = null;

export function initDnd(pane, { onDrop, onHoverTab }) {
  pane.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.grip');
    if (!grip || e.button !== 0 || !pane.classList.contains('can-drag')) return;
    e.preventDefault();
    const taskEl = grip.closest('.task');
    drag = { pane, taskEl, startX: e.clientX, startY: e.clientY, started: false, pointerId: e.pointerId, onDrop, onHoverTab };
    // Captured on the pane, not the grip: the lifted row is moved in the DOM
    // when the drag starts, and moving an element drops its pointer capture.
    pane.setPointerCapture(e.pointerId);
    pane.addEventListener('pointermove', onMove);
    pane.addEventListener('pointerup', onUp);
    pane.addEventListener('pointercancel', onCancel);
  });
  window.addEventListener('keydown', (e) => {
    if (drag?.started && e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }, true);
}

function begin() {
  const { taskEl, pane } = drag;
  const r = taskEl.getBoundingClientRect();
  drag.offsetX = drag.startX - r.left;
  drag.offsetY = drag.startY - r.top;
  drag.origin = { parent: taskEl.parentElement, next: taskEl.nextElementSibling };

  const ph = document.createElement('div');
  ph.className = 'drop-placeholder';
  ph.style.height = `${r.height}px`;
  taskEl.before(ph);
  drag.placeholder = ph;

  taskEl.style.width = `${r.width}px`;
  taskEl.style.left = `${r.left}px`;
  taskEl.style.top = `${r.top}px`;
  taskEl.classList.add('dragging');
  // Lifted out of its list, so it stays visible if that list's side tab is
  // switched away mid-drag.
  pane.append(taskEl);
  pane.classList.add('dragging');
  drag.started = true;
}

function siblingsRects(list) {
  const m = new Map();
  for (const c of list.children) if (c !== drag.taskEl) m.set(c, c.getBoundingClientRect());
  return m;
}

function slide(before) {
  for (const [el, old] of before) {
    if (!el.isConnected) continue;
    const now = el.getBoundingClientRect();
    const dy = old.top - now.top;
    if (Math.abs(dy) > 0.5) {
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: EASE });
    }
  }
}

// The list under the pointer. Over a section heading, the gap between
// sections or a panel's empty space, the nearest list in that panel.
function listAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const list = hit.closest('.list');
  if (list) return list;
  const panel = hit.closest('.panel');
  if (!panel) return null;
  let best = null, bestDist = Infinity;
  for (const l of panel.querySelectorAll('.list')) {
    const r = l.getBoundingClientRect();
    if (!r.height && !r.width) continue;   // a hidden side tab
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestDist) { best = l; bestDist = d; }
  }
  return best;
}

function onMove(e) {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < START_PX) return;
    begin();
  }
  const { taskEl, placeholder } = drag;
  taskEl.style.left = `${e.clientX - drag.offsetX}px`;
  taskEl.style.top = `${e.clientY - drag.offsetY}px`;

  const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest('.side-tab');
  if (tab && !tab.classList.contains('active')) drag.onHoverTab?.(tab.dataset.tab);

  const list = listAt(e.clientX, e.clientY) || placeholder.parentElement;
  const items = [...list.children].filter((c) => c !== taskEl && c !== placeholder);
  const next = items.find((c) => {
    const r = c.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  }) || null;
  if (placeholder.parentElement !== list || placeholder.nextElementSibling !== next) {
    const affected = new Set([placeholder.parentElement, list]);
    const before = new Map();
    for (const l of affected) for (const [el, r] of siblingsRects(l)) before.set(el, r);
    list.insertBefore(placeholder, next);
    slide(before);
  }
  autoScroll(list, e.clientY);
}

// Near the top or bottom of a scrolled panel, scroll it.
function autoScroll(list, y) {
  const panel = list.closest('.panel');
  if (!panel) return;
  const r = panel.getBoundingClientRect();
  const zone = 36;
  if (y < r.top + zone) panel.scrollTop -= 8;
  else if (y > r.bottom - zone) panel.scrollTop += 8;
}

function release() {
  const { pane, pointerId } = drag;
  pane.removeEventListener('pointermove', onMove);
  pane.removeEventListener('pointerup', onUp);
  pane.removeEventListener('pointercancel', onCancel);
  try { pane.releasePointerCapture(pointerId); } catch (_) {}
}

function cleanup() {
  const { taskEl, pane } = drag;
  release();
  taskEl.classList.remove('dragging');
  taskEl.style.width = taskEl.style.left = taskEl.style.top = '';
  pane.classList.remove('dragging');
}

// Lands the row where the placeholder is, gliding from where it was dropped.
function settle(parent, next) {
  const { taskEl, placeholder } = drag;
  const from = taskEl.getBoundingClientRect();
  placeholder.remove();
  cleanup();
  parent.insertBefore(taskEl, next);
  const to = taskEl.getBoundingClientRect();
  taskEl.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }],
    { duration: 220, easing: EASE });
}

function onUp() {
  if (!drag) return;
  if (!drag.started) {
    release();
    drag = null;
    return;
  }
  const { placeholder, taskEl, onDrop } = drag;
  const list = placeholder.parentElement;
  // The lifted row sits in the pane while dragged, so the placeholder's
  // neighbours are the real ones.
  const prev = placeholder.previousElementSibling;
  const next = placeholder.nextElementSibling;
  settle(list, next);
  const id = taskEl.dataset.id;
  drag = null;
  onDrop(id, {
    list: list.dataset.list,           // 'today' | 'ongoing'
    listStatus: list.dataset.status,   // '' = the flat board list, or the Ongoing list
    prevId: prev?.dataset.id || null,
    nextId: next?.dataset.id || null,
  });
}

function onCancel() {
  if (!drag) return;
  if (drag.started) settle(drag.origin.parent, drag.origin.next);
  else cleanup();
  drag = null;
}
