import { useStore } from '../store';

/**
 * A 10 s clip of a moment (round 8, C9 + highlight clips): the map's canvas layers drawn into one picture each frame,
 * with the card's line (and the Rage line when it's on) and the site's name on top, recorded in the browser
 * (MediaRecorder, WebM) and handed over as a file. Nothing is uploaded. The replay plays from 6 s before the moment to
 * 4 s after, at normal speed, then goes back to where it was.
 */
export const CLIP_BEFORE = 6, CLIP_AFTER = 4;

/** `font`: the caption's size in px of the recording (18 for a clip you save; bigger for a clip shown small, like the front page's). */
export async function recordClip(board: HTMLElement, at: number, lines: { title: string; rage?: string | null; mark: string; color: string; /** the card's win bar: the side's chance before and after */ win?: { side: string; before: number; after: number } }, bitrate = 4_000_000, font = 18): Promise<Blob> {
  const layers = [...board.querySelectorAll('canvas')].filter(c => c.width > 50 && c.height > 50);
  if (!layers.length || typeof MediaRecorder === 'undefined') throw new Error('This browser can\'t record the map.');
  const W = layers[0].width, H = layers[0].height;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d')!;
  const scale = W / layers[0].getBoundingClientRect().width || 1;
  const draw = () => {
    g.fillStyle = '#0A0C10'; g.fillRect(0, 0, W, H);
    for (const c of layers) g.drawImage(c, 0, 0, W, H);
    // the card's line along the bottom, the mark in its colour, the Rage line above it
    const pad = font * scale, fs = Math.round(font * scale);
    if (lines.win) {
      // a card bottom-left like the app's: a badge in the mark's colour, the line, and the win bar
      const m = Math.max(16, 16 * scale), bw = Math.min(W * 0.62, 30 * fs), ch = 4 * fs, x = m, y = H - m - ch;
      g.fillStyle = 'rgba(18,22,28,0.92)'; g.beginPath(); g.roundRect(x, y, bw, ch, 10 * scale); g.fill();
      g.strokeStyle = lines.color; g.lineWidth = 2 * scale; g.stroke();
      g.font = `700 ${fs}px Onest, system-ui, sans-serif`; const bwid = g.measureText(lines.mark).width + fs;
      g.fillStyle = lines.color; g.beginPath(); g.roundRect(x + fs * 0.5, y + fs * 0.5, bwid, fs * 1.4, 6 * scale); g.fill();
      g.fillStyle = '#0A0C10'; g.textBaseline = 'middle'; g.fillText(lines.mark, x + fs, y + fs * 1.2);
      g.fillStyle = '#ECEFF4'; g.font = `600 ${fs}px Onest, system-ui, sans-serif`;
      let t = lines.title; const room = bw - bwid - fs * 2.2; while (t.length > 8 && g.measureText(t).width > room) t = t.slice(0, -2).trimEnd() + '…';
      g.fillText(t, x + fs * 1.2 + bwid, y + fs * 1.2);
      const by = y + fs * 2.4, bl = bw - fs, fill = Math.max(0, Math.min(1, lines.win.after / 100));
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(x + fs * 0.5, by, bl, fs * 0.3);
      g.fillStyle = lines.win.after >= lines.win.before ? '#2DD4BF' : '#FF6B3D'; g.fillRect(x + fs * 0.5, by, bl * fill, fs * 0.3);
      g.fillStyle = '#A3ACBA'; g.font = `500 ${Math.round(fs * 0.78)}px Onest, system-ui, sans-serif`; g.fillText(`${lines.win.side} ${lines.win.before}% → ${lines.win.after}%`, x + fs * 0.5, by + fs * 0.85);
      g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(236,239,244,0.7)'; g.font = `800 ${Math.round(font * 0.9 * scale)}px 'Sofia Sans Extra Condensed', Oswald, system-ui, sans-serif`; g.textAlign = 'right';
      g.fillText('RageView', W - m, m + font * 0.9 * scale); g.textAlign = 'left';
      return;
    }
    g.fillStyle = 'rgba(10,12,16,0.82)'; g.fillRect(0, H - (lines.rage ? 4.4 : 2.6) * fs - pad, W, (lines.rage ? 4.4 : 2.6) * fs + pad);
    g.font = `700 ${fs}px Onest, system-ui, sans-serif`; g.textBaseline = 'alphabetic';
    g.fillStyle = lines.color; g.fillText(lines.mark, pad, H - pad - (lines.rage ? 1.8 * fs : 0));
    const mw = g.measureText(lines.mark).width;
    g.fillStyle = '#ECEFF4'; g.font = `600 ${fs}px Onest, system-ui, sans-serif`;
    // the line has to fit the picture: cut it with an ellipsis rather than run off the edge
    let title = lines.title.slice(0, 90); const room = W - pad * 2 - mw - 12 * scale;
    while (title.length > 8 && g.measureText(title).width > room) title = title.slice(0, -2).trimEnd() + '…';
    g.fillText(title, pad + mw + 12 * scale, H - pad - (lines.rage ? 1.8 * fs : 0));
    if (lines.rage) { g.fillStyle = '#FF4D3D'; g.font = `700 ${fs}px Onest, system-ui, sans-serif`; g.fillText(lines.rage.slice(0, 100), pad, H - pad); }
    g.fillStyle = 'rgba(236,239,244,0.7)'; g.font = `700 ${Math.round(font * 0.78 * scale)}px 'Sofia Sans Extra Condensed', Oswald, system-ui, sans-serif`; g.textAlign = 'right';
    g.fillText('RageView', W - pad, pad + font * 0.78 * scale); g.textAlign = 'left';
  };
  const st = useStore.getState();
  const was = { time: st.time, playing: st.playing, speed: st.speed, popups: st.popups };
  // no slow motion for reading cards while recording
  st.setPopups(false);
  st.setPlaying(false); st.setSpeed(1); st.setTime(Math.max(0, at - CLIP_BEFORE));
  await new Promise(r => setTimeout(r, 300));
  const stream = out.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>(ok => { rec.onstop = () => ok(new Blob(chunks, { type: 'video/webm' })); });
  let raf = 0;
  const tick = () => { draw(); raf = requestAnimationFrame(tick); };
  tick();
  rec.start(250);
  useStore.getState().setPlaying(true);
  await new Promise(r => setTimeout(r, (CLIP_BEFORE + CLIP_AFTER) * 1000));
  rec.stop(); cancelAnimationFrame(raf);
  const s2 = useStore.getState();
  s2.setPlaying(false); s2.setSpeed(was.speed); s2.setTime(was.time); s2.setPopups(was.popups);
  return done;
}

/** Hands the clip over as a file. */
export function saveClip(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
