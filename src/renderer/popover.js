// Small glass menus anchored to a button: the status picker, the priority
// picker and the compact row's "…" menu. One open at a time; arrow keys,
// Enter and Esc work while it is open.
const layer = () => document.getElementById('popover-layer');

let current = null; // { el, anchor, items, active, onClose }

export function isOpen() {
  return !!current;
}

export function closePopover() {
  if (!current) return false;
  const { el, anchor, onClose } = current;
  current = null;
  anchor.classList.remove('open');
  el.classList.add('closing');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 200);
  onClose?.();
  return true;
}

// items: { label, icon?: html, swatch?: { color, kind: 'fill'|'ring'|'none' },
//          checked?, danger?, onPick } | { sep: true } | { heading: 'text' }
export function openPopover(anchor, items, { onClose } = {}) {
  const reopen = current?.anchor === anchor;
  closePopover();
  if (reopen) return; // a second click on the same button closes it

  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'menu');
  const buttons = [];
  for (const item of items) {
    if (item.sep) {
      el.append(Object.assign(document.createElement('div'), { className: 'pop-sep' }));
      continue;
    }
    if (item.heading) {
      el.append(Object.assign(document.createElement('div'), { className: 'pop-label', textContent: item.heading }));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'pop-item' + (item.danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem');
    if (item.swatch) {
      const sw = document.createElement('span');
      sw.className = 'swatch' + (item.swatch.kind === 'ring' ? ' ring-sw' : item.swatch.kind === 'none' ? ' none' : '');
      if (item.swatch.color) sw.style.setProperty('--sw', item.swatch.color);
      b.append(sw);
    } else if (item.icon) {
      b.insertAdjacentHTML('beforeend', item.icon);
    }
    b.append(Object.assign(document.createElement('span'), { textContent: item.label }));
    if (item.checked) b.insertAdjacentHTML('beforeend', '<span class="check">✓</span>');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover();
      item.onPick?.();
    });
    b.addEventListener('pointerenter', () => setActive(buttons.indexOf(b)));
    buttons.push(b);
    el.append(b);
  }
  layer().append(el);
  anchor.classList.add('open');

  // Below the anchor, flipped above if it would run off the window, and kept
  // inside it horizontally.
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const M = 8;
  let top = a.bottom + 6;
  if (top + h > innerHeight - M) top = Math.max(M, a.top - 6 - h);
  let left = a.left;
  left = Math.min(left, innerWidth - M - w);
  left = Math.max(M, left);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transformOrigin = `${a.left + a.width / 2 - left}px ${top > a.top ? 0 : h}px`;

  current = { el, anchor, buttons, active: -1, onClose };
  const checked = items.filter((i) => !i.sep && !i.heading).findIndex((i) => i.checked);
  setActive(checked);
}

function setActive(i) {
  if (!current) return;
  current.buttons.forEach((b, j) => b.classList.toggle('active', j === i));
  current.active = i;
}

// Keyboard while a popover is open. Returns true when the key was used.
export function handlePopoverKey(e) {
  if (!current) return false;
  const n = current.buttons.length;
  if (e.key === 'Escape') { closePopover(); return true; }
  if (e.key === 'ArrowDown') { setActive((current.active + 1 + n) % n); return true; }
  if (e.key === 'ArrowUp') { setActive((current.active - 1 + n) % n); return true; }
  if (e.key === 'Enter' || e.key === ' ') {
    current.buttons[current.active]?.click();
    return true;
  }
  return false;
}

// A press anywhere outside closes it.
document.addEventListener('pointerdown', (e) => {
  if (!current) return;
  if (current.el.contains(e.target) || current.anchor.contains(e.target)) return;
  closePopover();
}, true);
window.addEventListener('blur', () => closePopover());
