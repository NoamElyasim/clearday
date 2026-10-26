// Rich text in the DOM: task text is plain text plus bold ranges (see
// model.mjs). These turn that into <b> runs and back, and map the browser
// selection to character offsets so the B button bolds exactly what is
// selected.
import { segments, fromSegments } from '../shared/model.mjs';

export function renderRich(el, text, bold) {
  el.replaceChildren(...segments(text, bold).map((run) => {
    if (!run.bold) return document.createTextNode(run.text);
    const b = document.createElement('b');
    b.textContent = run.text;
    return b;
  }));
}

// What a contenteditable row holds now, as { text, bold }. Only <b>/<strong>
// carry weight; anything else the editor inserted is read as plain text, and
// line breaks become spaces (a task is one line of thought).
export function serialize(el) {
  const runs = [];
  const walk = (node, bold) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        runs.push({ text: child.nodeValue.replace(/\n/g, ' '), bold });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'BR') { runs.push({ text: ' ', bold }); continue; }
        walk(child, bold || child.tagName === 'B' || child.tagName === 'STRONG');
      }
    }
  };
  walk(el, false);
  return fromSegments(runs);
}

function lengthTo(el, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, offset);
  return r.toString().length;
}

// The part of the current selection that falls inside `el`, as character
// offsets, or null when the selection does not touch it.
export function selectionOffsets(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(el)) return null;
  // A selection dragged across several rows is clipped to this one.
  const len = el.textContent.length;
  const start = el.contains(r.startContainer) ? lengthTo(el, r.startContainer, r.startOffset) : 0;
  const end = el.contains(r.endContainer) ? lengthTo(el, r.endContainer, r.endOffset) : len;
  return { start, end, collapsed: end <= start };
}

// Puts the selection back over the same characters after a re-render.
export function setSelection(el, start, end = start) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode = null, startOff = 0, endNode = null, endOff = 0;
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue.length;
    if (!startNode && start <= pos + len) { startNode = n; startOff = start - pos; }
    if (!endNode && end <= pos + len) { endNode = n; endOff = end - pos; }
    pos += len;
    last = n;
  }
  const r = document.createRange();
  if (!last) {
    r.selectNodeContents(el);
    r.collapse(false);
  } else {
    r.setStart(startNode || last, startNode ? startOff : last.nodeValue.length);
    r.setEnd(endNode || last, endNode ? endOff : last.nodeValue.length);
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

export function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
