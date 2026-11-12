// The nightly coach check (.github/workflows/coach-check.yml, also "Check the coach now" on the dev page): pulls the
// moments the owner has ruled on (each carries its own round), grades them with the coach as it is on main, and
// reports how often it agrees to the Worker, which the dev page charts (Coach). Needs STRATBOARD_SERVER_TOKEN.
//   npm run coach:check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullDisputes, workerLink } from './disputes-lib';
import { scoreVerdicts } from './verdicts-lib';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-check-'));
const pulled = await pullDisputes(dir);
console.log(pulled);
const { right, total, lines } = scoreVerdicts(dir);
console.log(lines.filter(l => !l.startsWith('ok')).slice(0, 40).join('\n'));
console.log(`Agrees with the owner's rulings on ${right} of ${total}.`);
const link = workerLink();
if (link) {
  const res = await fetch(`${link.url}/internal/coach-eval`, {
    method: 'POST', headers: { Authorization: `Bearer ${link.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ game: 'cs2', right, total, sha: (process.env.GITHUB_SHA ?? '').slice(0, 12), note: pulled }),
  });
  console.log(`Reported to the dev page: ${res.status}`);
}
