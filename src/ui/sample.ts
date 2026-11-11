import { navigate } from '../shell/router';
import { useStore } from '../store';

/** The CS2 sample (a FACEIT level-10 Mirage match, names and IDs replaced: public/samples), opened in Review like your own demo. */
export async function openCs2Sample() {
  const res = await fetch('/samples/cs2-mirage.json.gz');
  if (!res.ok) throw new Error(String(res.status));
  // still gzipped (GitHub Pages) or already unpacked by the server (the dev server sends it gzip-encoded)
  const bytes = new Uint8Array(await res.arrayBuffer());
  const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
  useStore.getState().startReview({ ...JSON.parse(json), sample: true });
  navigate({ page: 'cs2', mode: 'review' });
  document.querySelector('.shell-main')?.scrollTo({ top: 0 }); // from a scrolled page: the replay starts at the top
}
