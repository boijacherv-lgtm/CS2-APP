import { premierOf, type ProfileMatch } from '../engine/profile';
import { LETTER_COLOR } from '../engine/recap';
import { mapName } from './format';
import { T } from '../ui/tokens';

/**
 * A match as a picture to share (Discord, socials): 1200×630, the size link previews use. Drawn here in the browser
 * from your profile's numbers; nothing is uploaded.
 */
export const SHARE_W = 1200, SHARE_H = 630;

const loadImage = (src: string) => new Promise<HTMLImageElement | null>(ok => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => ok(null);
  img.src = src;
});

export async function drawShareCard(canvas: HTMLCanvasElement, m: ProfileMatch, player: string) {
  canvas.width = SHARE_W; canvas.height = SHARE_H;
  const g = canvas.getContext('2d')!;
  await document.fonts?.ready;
  const display = (px: number) => `700 ${px}px Rajdhani, 'Barlow Condensed', system-ui, sans-serif`;
  const ui = (px: number, w = 500) => `${w} ${px}px Inter, system-ui, sans-serif`;

  g.fillStyle = T.bg0; g.fillRect(0, 0, SHARE_W, SHARE_H);
  // the map's radar, faint, on the right
  const radar = await loadImage(`/images/maps/${m.map}.png`);
  if (radar) { g.globalAlpha = 0.28; g.drawImage(radar, SHARE_W - 600, 15, 600, 600); g.globalAlpha = 1; }
  const fade = g.createLinearGradient(SHARE_W - 640, 0, SHARE_W - 260, 0);
  fade.addColorStop(0, T.bg0); fade.addColorStop(1, 'rgba(10,12,16,0)');
  g.fillStyle = fade; g.fillRect(SHARE_W - 640, 0, 400, SHARE_H);
  // a team-coloured edge
  g.fillStyle = T.ct; g.fillRect(0, 0, 8, SHARE_H / 2);
  g.fillStyle = T.t; g.fillRect(0, SHARE_H / 2, 8, SHARE_H / 2);

  const x = 72;
  g.fillStyle = T.text2; g.font = ui(26, 600); g.fillText(player, x, 92);
  g.fillStyle = T.text1; g.font = display(96); g.fillText(mapName(m.map).toUpperCase(), x, 190);
  const won = m.result === 'win', lost = m.result === 'loss';
  g.font = display(72);
  g.fillStyle = won ? T.good : lost ? T.bad : T.text2;
  const score = `${m.score[0]} : ${m.score[1]}`;
  g.fillText(score, x, 280);
  const sw = g.measureText(score).width;
  g.font = ui(24, 700); g.fillText(won ? 'VICTORY' : lost ? 'DEFEAT' : 'DRAW', x + sw + 24, 270);

  // the grade
  const grade = m.level ?? m.lobby;
  g.fillStyle = LETTER_COLOR[grade];
  roundRect(g, x, 330, 150, 150, 26); g.fill();
  g.fillStyle = '#111'; g.font = display(104); g.textAlign = 'center'; g.fillText(grade, x + 75, 444); g.textAlign = 'left';
  g.fillStyle = T.text2; g.font = ui(20, 600); g.fillText(m.level ? 'LEVEL' : 'LOBBY GRADE', x, 515);

  // the numbers
  const stats: [string, string][] = [
    ['K / D', `${m.kills} / ${m.deaths}`], ['ADR', m.adr.toFixed(0)], ['KAST', `${m.kast.toFixed(0)}%`],
    ...(premierOf(m) !== null ? [['PREMIER', premierOf(m)!.toLocaleString('en-US')] as [string, string]] : []),
  ];
  stats.forEach(([k, v], i) => {
    const cx = x + 210 + (i % 2) * 210, cy = 370 + Math.floor(i / 2) * 105;
    g.fillStyle = T.text3; g.font = ui(18, 600); g.fillText(k, cx, cy);
    g.fillStyle = T.text1; g.font = display(52); g.fillText(v, cx, cy + 52);
  });

  g.fillStyle = T.text3; g.font = ui(20, 600); g.fillText('Graded by RageView · tsakhstvo.xyz', x, SHARE_H - 40);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export const shareFileName = (m: ProfileMatch) => `rageview-${m.map.replace('de_', '')}-${m.score[0]}-${m.score[1]}.png`;

/** Copies the picture to the clipboard (where the browser allows it). */
export async function copyCard(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/png'));
    if (!blob || !navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch { return false; }
}
