import { navigate } from '../shell/router';
import { useStore } from '../store';
import { siteConfig } from './siteConfig';

/** The CS2 sample (a FACEIT level-10 Mirage match, names and IDs replaced: public/samples), opened in Review like your own demo. */
export async function openCs2Sample() {
  const res = await fetch(siteConfig().samples.cs2); // the dev page can pick another sample (Content)
  if (!res.ok) throw new Error(String(res.status));
  // still gzipped (GitHub Pages) or already unpacked by the server (the dev server sends it gzip-encoded)
  const bytes = new Uint8Array(await res.arrayBuffer());
  const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
  useStore.getState().startReview({ ...JSON.parse(json), sample: true });
  navigate({ page: 'cs2', mode: 'review' });
  document.querySelector('.shell-main')?.scrollTo({ top: 0 }); // from a scrolled page: the replay starts at the top
}

/** The Deadlock sample: a public Phantom+ match (46 min), opened from deadlock-api like any match ID. */
export const DL_SAMPLE_MATCH = 131074890;
export async function openDlSample() {
  const { openMatch } = await import('../deadlock/open');
  await openMatch(siteConfig().samples.deadlock || DL_SAMPLE_MATCH);
  navigate({ page: 'deadlock', mode: 'review' });
  document.querySelector('.shell-main')?.scrollTo({ top: 0 });
}

/** The Dota 2 sample: a pro match on patch 7.42 (Froglings vs HULIGANI, 42 min), opened from OpenDota like any match ID. */
export const D2_SAMPLE_MATCH = 9096888698;
export async function openD2Sample() {
  const { loadMatch, rememberMatch } = await import('../dota2/api');
  const { useD2 } = await import('../dota2/store');
  const m = await loadMatch(siteConfig().samples.dota2 || D2_SAMPLE_MATCH); // the dev page can pick another match (Content)
  rememberMatch(m);
  useD2.getState().open(m);
  navigate({ page: 'dota2', mode: 'review' });
  document.querySelector('.shell-main')?.scrollTo({ top: 0 });
}
