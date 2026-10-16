import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { activeView, useStore, type Overlay, type ViewName } from '../store';

export const VIEWS: { id: ViewName; label: string; key: string; hint: string }[] = [
  { id: 'clean', label: 'Clean', key: '1', hint: 'Only players, routes and grenades' },
  { id: 'standard', label: 'Standard', key: '2', hint: 'Map control, entry lines, callouts, guns' },
  { id: 'full', label: 'Full', key: '3', hint: 'Everything: vision cones, entry cards and more' },
];

/** Individual layers, grouped. `review: false` = not offered while reviewing a match. */
const GROUPS: { title: string; items: { id: Overlay; label: string; review?: boolean }[] }[] = [
  {
    title: 'Overlays',
    items: [
      { id: 'control', label: 'Map control (CT coverage)' },
      { id: 'vision', label: 'Vision cones, who sees whom' },
      { id: 'los', label: 'Sightline of selected player' },
    ],
  },
  {
    title: 'Labels',
    items: [
      { id: 'callouts', label: 'Callout names (main)' },
      { id: 'calloutsAll', label: 'All callout names (detailed spots)' },
      { id: 'threat', label: 'Entry lines (who holds what)', review: false },
      { id: 'entryCards', label: 'Entry cards with details', review: false },
      { id: 'playerInfo', label: 'Gun and kill chance on players' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'killmap', label: 'Best spots (selected CT)', review: false },
      { id: 'timing', label: 'Spawn timing race' },
      { id: 'lineups', label: 'Line-ups on map' },
      { id: 'walkable', label: 'Walkable floor (debug)' },
    ],
  },
];

/** Floating control on the board: how busy the map is (Clean / Standard / Full) and per-layer switches, in one menu. */
export function LayersBar() {
  const overlays = useStore(s => s.overlays);
  const mode = useStore(s => s.mode);
  const toggle = useStore(s => s.toggleOverlay);
  const setView = useStore(s => s.setView);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = activeView(overlays);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const label = VIEWS.find(v => v.id === current)?.label ?? 'Custom';
  return (
    <div className="layers" ref={box}>
      {/* one compact button (it never gets squeezed); the presets and every layer are in its menu */}
      <button className={`layers-btn ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}
        title="How much the map shows (keys 1 2 3), and every layer">
        <Icon name="layers" className="layers-ico" /> {label} <Icon name="chevronDown" size={8} />
      </button>
      {open && (
        <div className="layers-menu">
          <div className="seg-mini" role="group" aria-label="How much the map shows">
            {VIEWS.map(v => (
              <button key={v.id} className={current === v.id ? 'on' : ''} onClick={() => setView(v.id)} title={`${v.hint} (key ${v.key})`}>
                {v.label}
              </button>
            ))}
          </div>
          {GROUPS.map(g => {
            const items = g.items.filter(i => mode !== 'review' || i.review !== false);
            if (!items.length) return null;
            return (
              <div key={g.title} className="layers-group">
                <h4>{g.title}</h4>
                {items.map(i => (
                  <label key={i.id} className="check">
                    <input type="checkbox" checked={overlays[i.id]} onChange={() => toggle(i.id)} /> {i.label}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
