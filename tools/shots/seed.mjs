// Demo board used by the screenshot harness and dev runs: every status, both
// priorities, partial bold, notes, and a few Ongoing projects. `node tools/shots/seed.mjs <dir>` writes it
// as <dir>/tasks.json.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTask, applyPatch, SCHEMA_VERSION } from '../../src/shared/model.mjs';

// Bold is given as the words to bold, so the ranges can't drift from the text.
const word = (text, w) => { const i = text.indexOf(w); return [i, i + w.length]; };

const ROWS = [
  { text: 'Review the Houston demo deck', boldWords: ['Houston demo deck'], status: 'in_progress', priority: 'high',
    notes: 'Slides 4–7 still use the old logo.\nAsk Ben for the final booth photo.' },
  { text: 'Reply to the investor follow-up email', status: 'in_progress', priority: 'medium' },
  { text: 'Send the booth quote to finance', status: 'awaiting_approval', priority: 'medium' },
  { text: 'Book flights for ADIPEC', boldWords: ['Book'], status: 'on_hold',
    notes: 'Waiting on final dates.' },
  { text: 'Export the booth wall print files', status: 'done', priority: 'high' },
  { text: 'Morning standup', status: 'done' },
  { text: 'Draft the LinkedIn post for Thursday', boldWords: ['Thursday'], status: 'todo', priority: 'medium' },
  { text: 'Update the product one-pager', status: 'todo' },
  { text: 'Call the print shop about vinyl stock', status: 'todo', priority: 'high' },
  { text: 'Website redesign', boldWords: ['Website'], status: 'in_progress', priority: 'high', list: 'ongoing',
    notes: 'Phase 1: product pages.\nPhase 2: blog and press.' },
  { text: 'Brand guidelines v2', status: 'awaiting_approval', list: 'ongoing' },
  { text: 'Plan the 2027 trade show calendar', status: 'todo', list: 'ongoing' },
];

export function seedTasks(base = Date.parse('2026-10-26T07:00:00Z')) {
  return ROWS.map((r, i) => {
    const t = createTask({ text: r.text, bold: (r.boldWords || []).map((w) => word(r.text, w)), status: r.status, priority: r.priority || null, list: r.list || 'today', order: i + 1 },
      base + i * 60000);
    return r.notes ? applyPatch(t, { notes: r.notes }, base + i * 60000) : t;
  });
}

export function writeSeed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({
    schemaVersion: SCHEMA_VERSION, deviceId: 'seed', tasks: seedTasks(),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) writeSeed(process.argv[2]);
