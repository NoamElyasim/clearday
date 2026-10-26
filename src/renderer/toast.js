// Bottom-centre toasts, e.g. "Task deleted · Undo".
const MAX = 3;

export function showToast(message, { action, onAction, duration = 5000 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.append(Object.assign(document.createElement('span'), { textContent: message }));

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('closing')) return;
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 250);
  };

  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.addEventListener('click', () => { dismiss(); onAction?.(); });
    el.append(b);
  }
  host.append(el);
  while (host.children.length > MAX) host.firstElementChild.remove();

  // Paused while the pointer is on it, so there is time to reach Undo.
  const arm = () => { timer = setTimeout(dismiss, duration); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  arm();
  return dismiss;
}
