"use client";

// Small building blocks for the "spatial" look: a light field behind the page
// that follows the pointer, glass cards that tilt toward it, numbers that count
// up, and a countdown ring. All of them stand still under prefers-reduced-motion.

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Drifting aurora behind everything; shifts gently with the pointer for depth. */
export function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        ref.current?.style.setProperty("--mx", x.toFixed(3));
        ref.current?.style.setProperty("--my", y.toFixed(3));
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <div ref={ref} className="backdrop" aria-hidden="true">
      <span className="orb orb-a" />
      <span className="orb orb-b" />
      <span className="orb orb-c" />
      <span className="orb orb-d" />
      <span className="grain" />
    </div>
  );
}

type TiltProps = HTMLAttributes<HTMLDivElement> & { max?: number; children: ReactNode };

/** A glass card that leans toward the pointer and catches a highlight. */
export function Tilt({ max = 7, className = "", style, children, ...rest }: TiltProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch" || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${((0.5 - y) * max).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * max).toFixed(2)}deg`);
    el.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    el.dataset.active = "true";
  };
  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    delete el.dataset.active;
  };

  return (
    <div ref={ref} className={`tilt ${className}`} style={style} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} {...rest}>
      {children}
    </div>
  );
}

/** Animates from the previous value to the new one. */
export function CountUp({ value, format, duration = 1100 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const v = origin + (value - origin) * eased;
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <span className="countup">{format(shown)}</span>;
}

/** Circular countdown: how much of the response window is left. */
export function Ring({ fraction, size = 120, tone, children }: { fraction: number; size?: number; tone: "ok" | "warn" | "danger"; children: ReactNode }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className={`ring ring-${tone}`} style={{ width: size, height: size } as CSSProperties}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ "--dash": c, "--offset": c * (1 - f) } as CSSProperties}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}
