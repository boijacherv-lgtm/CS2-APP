/**
 * Backup for the bots' timer: GitHub sometimes starts scheduled runs late or not at all, so every 15 minutes the
 * Worker starts the Bots workflow (.github/workflows/bots.yml) itself, unless a run started in the last 12 minutes
 * (then it was GitHub's own timer, or one still going). Needs the secret GH_TOKEN: a fine-grained GitHub token for this
 * repo with Actions read and write (wrangler secret put GH_TOKEN). Without it this does nothing.
 */
const REPO = 'boijacherv-lgtm/CS2-APP', WORKFLOW = 'bots.yml', GAP_MS = 12 * 60_000;

export async function kickBots(token: string | undefined): Promise<string> {
  if (!token) return 'no GH_TOKEN';
  const gh = (path: string, init?: RequestInit) => fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rageview-worker', 'X-GitHub-Api-Version': '2022-11-28', ...(init?.headers ?? {}) },
  });
  const last = await gh('/runs?per_page=1');
  if (!last.ok) return `runs: ${last.status}`;
  const run = ((await last.json()) as { workflow_runs?: { created_at: string; status: string }[] }).workflow_runs?.[0];
  if (run && (Date.now() - Date.parse(run.created_at) < GAP_MS || run.status === 'queued' || run.status === 'in_progress')) return 'recent or running';
  const res = await gh('/dispatches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
  return res.status === 204 ? 'started' : `dispatch: ${res.status}`;
}
