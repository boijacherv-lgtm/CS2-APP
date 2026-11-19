import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const seen = new Set<string>();

/**
 * A number that counts up once, the first time it's shown ("122", "69%", "+10.6%", "58.3k": the number part counts,
 * the rest stays). `id` keeps it from counting again when the same number is drawn again. Off with reduced motion.
 */
export function CountUp({ text, id, ms = 600 }: { text: string; id?: string; ms?: number }) {
  const m = text.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  const key = id ?? text;
  const [shown, setShown] = useState(() => (!m || reduced() || seen.has(key) ? text : `${m[1]}0${m[3]}`));
  const raf = useRef(0);
  useEffect(() => {
    if (!m || reduced() || seen.has(key)) { setShown(text); return; }
    seen.add(key);
    const target = parseFloat(m[2].replace(/,/g, '')), decimals = (m[2].split('.')[1] ?? '').length, t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), eased = 1 - (1 - k) ** 3;
      setShown(`${m[1]}${(target * eased).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${m[3]}`);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    // a hidden tab doesn't run animation frames: land on the number anyway
    const end = setTimeout(() => setShown(text), ms + 200);
    return () => { cancelAnimationFrame(raf.current); clearTimeout(end); };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{shown}</>;
}
