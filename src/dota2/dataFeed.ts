/** The game's live data from Valve's datafeed (gameData.ts, D2Meta.tsx), which doesn't let web pages read it: a few lists only. */
export function dotaDataUrl(query: URLSearchParams): string | null {
  const path = query.get('path') ?? '', hero = query.get('hero_id'), version = query.get('version');
  if (!['herolist', 'abilitylist', 'patchnoteslist', 'herodata', 'patchnotes'].includes(path)) return null;
  if (path === 'herodata' && !/^\d{1,4}$/.test(hero ?? '')) return null;
  if (path === 'patchnotes' && !/^\d\.\d{2}[a-z]?$/.test(version ?? '')) return null;
  const extra = path === 'herodata' ? `&hero_id=${hero}` : path === 'patchnotes' ? `&version=${version}` : '';
  return `https://www.dota2.com/datafeed/${path}?language=english${extra}`;
}
