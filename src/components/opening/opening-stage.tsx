"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Hand } from "lucide-react";
import { CITIES } from "@/lib/destinations";
import { angleBetween, arcPoints, clamp01, easeOut, easeOutBack, greeting, guessHome, landPoints, lngDelta, project, sceneLayout, spherePoint, unproject, viewTrig, type SpherePoint, type View } from "@/lib/opening";
import { MundiviMark, Wordmark } from "../brand";

/*
 * The opening scene itself (loaded only when it's shown; see opening-scene.tsx): a planet at
 * night, made of points of land, lighting up city by city from the visitor's own side of the
 * world, with flights arcing between the lights. A finger turns it (and it keeps turning a
 * little after), a light tapped says what's on there and can take you straight to it, a tap on
 * the dark sends a ripple of light across the ground, and "Start exploring" dives into the real
 * globe, which has been loading behind it all along.
 */

export type OpeningMode = "full" | "splash";
type City = { id: string; name: string; country: string; lat: number; lng: number; p: SpherePoint; ang: number; n: number };
type Arc = { pts: { p: SpherePoint; h: number }[]; start: number; dur: number };
type Ripple = { p: SpherePoint; t: number };

const fmt = (n: number) => n.toLocaleString("en-GB");
const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // no vibration here
  }
};

export default function OpeningStage({ mode, onDone }: { mode: OpeningMode; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useRef(false);
  const view = useRef<View>({ lat: 20, lng: 0 });
  const vel = useRef(0);
  const drag = useRef<{ x: number; y: number; id: number; moved: number; t: number } | null>(null);
  const leaving = useRef<number | null>(null);
  const aim = useRef<City | null>(null);
  const pickedRef = useRef<City | null>(null);
  const ripples = useRef<Ripple[]>([]);
  const counts = useRef<Map<string, number>>(new Map());
  const layout = useRef({ cx: 0, cy: 0, R: 0, side: false });
  const sceneT = useRef(0);
  const [stage, setStage] = useState(0); // 0 lighting up, 1 the words, 2 the hint
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<City | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [shownTotal, setShownTotal] = useState(0);
  const [out, setOut] = useState(false);
  const goBtn = useRef<HTMLButtonElement>(null);

  // The visitor's side of the world (from their clock), and the planet measured from there.
  const home = useMemo(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return guessHome(CITIES.map((c) => ({ lat: c.lat, lng: c.lng, timeZone: c.timeZone, name: c.name })), tz, new Date().getTimezoneOffset());
  }, []);
  const homeP = useMemo(() => spherePoint(home.lat, home.lng), [home]);
  const land = useMemo(() => landPoints().map((p) => ({ ...p, ang: angleBetween(p, homeP) })), [homeP]);
  const cities = useMemo<City[]>(
    () =>
      CITIES.map((c) => {
        const p = spherePoint(c.lat, c.lng);
        return { id: c.id, name: c.name, country: c.country ?? "", lat: c.lat, lng: c.lng, p, ang: angleBetween(p, homeP), n: 0 };
      }),
    [homeP],
  );

  // How much is on (the scene doesn't wait for it).
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/cities", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { cities?: { id: string; n: number }[] } | null) => {
        for (const c of j?.cities ?? []) counts.current.set(c.id, c.n);
        for (const c of cities) c.n = counts.current.get(c.id) ?? 0;
      })
      .catch(() => {});
    if (mode === "full")
      fetch("/api/events?limit=1", { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { total?: number } | null) => typeof j?.total === "number" && j.total > 0 && setTotal(j.total))
        .catch(() => {});
    return () => ctrl.abort();
  }, [cities, mode]);

  // The number counts up once it's there and the words are in.
  useEffect(() => {
    if (total == null || stage < 1) return;
    if (reduce.current) return setShownTotal(total);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = easeOut((now - t0) / 1300);
      setShownTotal(Math.round(total * k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [total, stage]);

  const leave = useCallback(
    (to?: City) => {
      if (leaving.current != null) return;
      leaving.current = performance.now();
      aim.current = to ?? null;
      setOut(true);
      if (to) buzz(12);
      window.setTimeout(
        () => {
          onDone();
          if (to) window.dispatchEvent(new CustomEvent("omni:fly", { detail: { lat: to.lat, lng: to.lng, zoom: 10.5, label: `${to.name}, ${to.country}` } }));
        },
        reduce.current ? 250 : 650,
      );
    },
    [onDone],
  );

  // The page under it stays put; Escape skips.
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [leave]);

  // The words, then the hint, as the planet lights up. The short version leaves by itself.
  useEffect(() => {
    if (mode === "splash") {
      const t = window.setTimeout(() => leave(), 1500);
      return () => window.clearTimeout(t);
    }
    const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const a = window.setTimeout(() => setStage(1), quick ? 0 : 2100);
    const b = window.setTimeout(() => setStage(2), quick ? 300 : 3600);
    return () => (window.clearTimeout(a), window.clearTimeout(b));
  }, [mode, leave]);
  // Focus goes to the scene itself (read out by screen readers); Tab reaches the buttons, and
  // no button shows a focus ring that nobody asked for.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  // ---- The drawing ----------------------------------------------------------------------------
  useEffect(() => {
    const cv = canvas.current;
    const box = root.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !box || !ctx) return;
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    view.current = { lat: Math.max(-20, Math.min(38, home.lat * 0.7)), lng: home.lng };
    const speed = mode === "splash" ? 1.8 : 1;
    // Canvas text can't read CSS variables: the page's own font, as resolved.
    const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";

    // A soft light, drawn once and stamped for every city.
    const glow = document.createElement("canvas");
    glow.width = glow.height = 64;
    const g = glow.getContext("2d")!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,236,170,1)");
    rg.addColorStop(0.22, "rgba(255,184,0,0.85)");
    rg.addColorStop(0.55, "rgba(255,140,0,0.22)");
    rg.addColorStop(1, "rgba(255,140,0,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);

    const stars = Array.from({ length: 140 }, (_, i) => ({ x: Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1), y: Math.abs((Math.sin(i * 78.233) * 12345.678) % 1), r: 0.4 + ((i * 37) % 10) / 12, ph: i }));
    let W = 0, H = 0, dpr = 1;
    // Sharpness drops to 1:1 on a phone that can't keep up (measured below).
    let maxDpr = 2;
    const size = () => {
      dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      // Room for the words as they really are (their size depends on the screen and the font).
      const words = box.querySelector<HTMLElement>(".opening-words");
      layout.current = sceneLayout(W, H, mode === "splash", words ? words.offsetHeight + 12 : undefined);
      const { cx, cy, R, side } = layout.current;
      // The words and the hint are placed round the planet.
      box.style.setProperty("--g-cx", `${cx}px`);
      box.style.setProperty("--g-cy", `${cy}px`);
      box.style.setProperty("--g-r", `${R}px`);
      box.toggleAttribute("data-side", side);
    };
    size();
    window.addEventListener("resize", size);

    // Flights between the lights: a few at a time, each drawn in, held and faded, then another.
    const pool = () => {
      const lit = cities.filter((c) => c.n > 0);
      return lit.length >= 4 ? lit : cities;
    };
    const pick = (): Arc => {
      const p = pool();
      const a = Math.random() < 0.55 ? { lat: home.lat, lng: home.lng } : p[Math.floor(Math.random() * p.length)];
      let b = p[Math.floor(Math.random() * p.length)];
      for (let k = 0; k < 6 && angleBetween(spherePoint(a.lat, a.lng), b.p) < 0.25; k++) b = p[Math.floor(Math.random() * p.length)];
      return { pts: arcPoints(a, b), start: 0, dur: 3.6 };
    };
    const arcs: Arc[] = Array.from({ length: mode === "splash" ? 0 : 4 }, (_, i) => ({ ...pick(), start: 2 + i * 0.45 }));
    // Now and then a light facing us says its name and what's on there, until a finger takes over.
    let whisper: { c: City; t: number } | null = null;
    let nextWhisper = 3.2;

    // The planet's body and its atmosphere, drawn once per size and stamped each frame.
    let bodyR = 0;
    let bodyDpr = 0;
    const bodyCv = document.createElement("canvas");
    const bodyOf = (R: number) => {
      if (Math.abs(R - bodyR) < 0.5 && bodyDpr === dpr) return bodyCv;
      bodyR = R;
      bodyDpr = dpr;
      const S = Math.ceil(R * 1.24 * 2 * dpr);
      bodyCv.width = bodyCv.height = S;
      const b = bodyCv.getContext("2d")!;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = S / dpr / 2;
      const atm = b.createRadialGradient(c, c, R * 0.96, c, c, R * 1.22);
      atm.addColorStop(0, "rgba(80,140,255,0.42)");
      atm.addColorStop(1, "rgba(80,140,255,0)");
      b.fillStyle = atm;
      b.beginPath();
      b.arc(c, c, R * 1.22, 0, Math.PI * 2);
      b.fill();
      const body = b.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R);
      body.addColorStop(0, "#14306e");
      body.addColorStop(0.65, "#0a1a44");
      body.addColorStop(1, "#050d26");
      b.fillStyle = body;
      b.beginPath();
      b.arc(c, c, R, 0, Math.PI * 2);
      b.fill();
      return bodyCv;
    };
    // Land dots are drawn in a few shades at once (one fill per shade, not one per dot).
    const SHADES = 8;
    const shade: number[][] = Array.from({ length: SHADES }, () => []);

    let raf = 0;
    let last = performance.now();
    let slow = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      // Frames coming slower than 30 a second, again and again: draw at 1:1 from then on.
      if (now - last > 34 && maxDpr > 1) {
        slow++;
        if (slow > 24) {
          maxDpr = 1;
          size();
        }
      } else slow = Math.max(0, slow - 1);
      last = now;
      const t = reduce.current ? 99 : ((now - t0) / 1000) * speed;
      sceneT.current = t;
      const v = view.current;

      // Turning: a finger, then its momentum, then a slow drift; or towards a chosen light.
      if (!drag.current) {
        const to = aim.current;
        if (to) {
          v.lng += lngDelta(v.lng, to.lng) * Math.min(1, dt * 5);
          v.lat += (Math.max(-40, Math.min(55, to.lat)) - v.lat) * Math.min(1, dt * 5);
        } else if (Math.abs(vel.current) > 0.5) {
          v.lng -= vel.current * dt;
          vel.current *= Math.pow(0.04, dt);
        } else if (!reduce.current) {
          v.lng += 7 * dt;
        }
      }

      const gone = leaving.current != null ? clamp01((now - leaving.current) / (reduce.current ? 250 : 650)) : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Stars.
      const starA = clamp01(t / 0.6) * (1 - gone);
      ctx.fillStyle = "#ffffff";
      for (const s of stars) {
        ctx.globalAlpha = starA * (0.35 + 0.35 * Math.sin(now / 900 + s.ph));
        ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
      }

      const { cx, cy, R: R0 } = layout.current;
      const grow = reduce.current ? 1 : easeOutBack((t - 0.4) / 0.85);
      const R = R0 * Math.max(0, grow) * (1 + gone * (reduce.current ? 0 : 1.8));
      const fade = 1 - gone;

      // The spark the planet grows from.
      if (t < 1.4 && !reduce.current) {
        const k = clamp01(t / 0.4);
        const r = 6 + 10 * Math.sin(Math.min(1, t / 0.5) * Math.PI);
        ctx.globalAlpha = k * clamp01((1.4 - t) / 0.6);
        ctx.drawImage(glow, cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
      }

      if (R > 1) {
        // Atmosphere and body (redrawn only while the planet is growing or diving).
        ctx.globalAlpha = fade;
        const bc = bodyOf(R);
        const half = bc.width / dpr / 2;
        ctx.drawImage(bc, cx - half, cy - half, half * 2, half * 2);

        const tr = viewTrig(v);
        // Land: a wave of dots from the visitor's side; a ripple tapped lifts the dots it passes.
        const wave = (t - 0.75) * 2.4;
        const dot = Math.max(1.1, R / 150);
        const live = ripples.current.filter((r) => now - r.t < 1600);
        ripples.current = live;
        for (const b of shade) b.length = 0;
        const lifted: number[] = [];
        for (const p of land) {
          if (p.ang > wave) continue;
          const q = project(p, tr);
          if (q.z <= 0) continue;
          let lift = 0;
          for (const r of live) {
            const front = ((now - r.t) / 1600) * 1.2;
            const d = Math.abs(angleBetween(p, r.p) - front);
            if (d < 0.08) lift = Math.max(lift, (1 - d / 0.08) * (1 - (now - r.t) / 1600));
          }
          const s = dot * (0.6 + 0.6 * q.z) * (1 + lift * 1.4);
          const x = cx + q.x * R - s / 2, y = cy - q.y * R - s / 2;
          if (lift > 0.05) {
            lifted.push(x, y, s, lift);
            continue;
          }
          const a = clamp01((wave - p.ang) / 0.5) * (0.18 + 0.62 * q.z);
          shade[Math.min(SHADES - 1, Math.floor(a * SHADES))].push(x, y, s);
        }
        ctx.fillStyle = "#a9c2ff";
        for (let i = 0; i < SHADES; i++) {
          const b = shade[i];
          if (!b.length) continue;
          ctx.globalAlpha = fade * ((i + 0.5) / SHADES);
          ctx.beginPath();
          for (let k = 0; k < b.length; k += 3) ctx.rect(b[k], b[k + 1], b[k + 2], b[k + 2]);
          ctx.fill();
        }
        ctx.fillStyle = "#ffe6a3";
        for (let k = 0; k < lifted.length; k += 4) {
          ctx.globalAlpha = fade * Math.min(1, 0.4 + lifted[k + 3] * 0.8);
          ctx.fillRect(lifted[k], lifted[k + 1], lifted[k + 2], lifted[k + 2]);
        }

        // Flights.
        if (!reduce.current && t > 2) {
          ctx.lineWidth = Math.max(1, R / 220);
          ctx.lineCap = "round";
          for (let i = 0; i < arcs.length; i++) {
            const a = arcs[i];
            const u = (t - a.start) / a.dur;
            if (u < 0) continue;
            if (u > 1) {
              arcs[i] = { ...pick(), start: t + 0.3 + Math.random() * 1.2 };
              continue;
            }
            const head = clamp01(u / 0.45);
            const tail = clamp01((u - 0.55) / 0.45);
            const n = a.pts.length - 1;
            const to = Math.ceil(head * n);
            ctx.beginPath();
            let pen = false;
            let hx = 0, hy = 0, hv = false;
            for (let k = Math.floor(tail * n); k <= to; k++) {
              const { p, h } = a.pts[k];
              const q = project(p, tr);
              const x = q.x * h, y = q.y * h;
              if (!(q.z > 0 || x * x + y * y > 1)) {
                pen = false;
                continue;
              }
              const sx = cx + x * R, sy = cy - y * R;
              if (pen) ctx.lineTo(sx, sy);
              else ctx.moveTo(sx, sy);
              pen = true;
              if (k === to) {
                hx = sx;
                hy = sy;
                hv = true;
              }
            }
            ctx.globalAlpha = fade * 0.75;
            ctx.strokeStyle = "rgba(120,200,255,0.9)";
            ctx.stroke();
            if (hv && head < 1) {
              ctx.globalAlpha = fade;
              ctx.drawImage(glow, hx - 7, hy - 7, 14, 14);
            }
          }
        }

        // The visitor's side of the world: a quiet blue pulse where the lights started.
        const hq = project(homeP, tr);
        if (home.name && hq.z > 0.05 && t > 0.9) {
          const k = (now / 1600) % 1;
          const hx = cx + hq.x * R, hy = cy - hq.y * R;
          ctx.globalAlpha = fade * (1 - k) * 0.7 * hq.z;
          ctx.strokeStyle = "#7fd3ff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hx, hy, 4 + k * Math.max(16, R / 9), 0, Math.PI * 2);
          ctx.stroke();
        }

        // City lights, from the visitor's side outwards, each with a flash as it comes on.
        const sel = pickedRef.current;
        for (const c of cities) {
          const on = t - 1.25 - c.ang * 0.42;
          if (on < 0) continue;
          const q = project(c.p, tr);
          if (q.z <= 0.03) continue;
          const sx = cx + q.x * R, sy = cy - q.y * R;
          const big = c.n > 0 ? 1 + Math.min(1.4, Math.log10(c.n + 1) * 0.45) : 0.7;
          const r = Math.max(4, R / 34) * big * (0.55 + 0.45 * q.z) * (1 + 0.12 * Math.sin(now / 420 + c.lat));
          ctx.globalAlpha = fade * clamp01(on / 0.25) * (0.45 + 0.55 * q.z);
          ctx.drawImage(glow, sx - r, sy - r, r * 2, r * 2);
          if (on < 0.7 && !reduce.current) {
            const k = on / 0.7;
            ctx.globalAlpha = fade * (1 - k) * 0.8;
            ctx.strokeStyle = "#ffd36b";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, r * (0.6 + 2.2 * k), 0, Math.PI * 2);
            ctx.stroke();
          }
          if (sel && sel.id === c.id) {
            const k = (now / 900) % 1;
            ctx.globalAlpha = fade * (1 - k);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sx, sy, r * (0.8 + 1.6 * k), 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = fade;
            ctx.font = `700 13px ${font}`;
            ctx.textAlign = "center";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(5,13,38,0.85)";
            ctx.strokeText(c.name, sx, sy - r - 8);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(c.name, sx, sy - r - 8);
          }
        }

        // A light says its name now and then (not once a light has been picked).
        if (mode === "full" && !reduce.current && !sel && t > nextWhisper) {
          const front = cities.filter((c) => c.n > 0 && project(c.p, tr).z > 0.55 && t - 1.25 - c.ang * 0.42 > 0.5);
          if (front.length) whisper = { c: front[Math.floor(Math.random() * front.length)], t };
          nextWhisper = t + 2.8;
        }
        if (whisper && !sel) {
          const k = (t - whisper.t) / 2.4;
          const q = project(whisper.c.p, tr);
          if (k < 1 && q.z > 0.2) {
            const a = Math.min(clamp01(k / 0.15), clamp01((1 - k) / 0.25));
            const sx = cx + q.x * R, sy = cy - q.y * R;
            ctx.globalAlpha = fade * a;
            ctx.textAlign = "center";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(5,13,38,0.85)";
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 13px ${font}`;
            ctx.strokeText(whisper.c.name, sx, sy - 22);
            ctx.fillText(whisper.c.name, sx, sy - 22);
            ctx.font = `500 11px ${font}`;
            ctx.fillStyle = "#ffd36b";
            const line = `${fmt(whisper.c.n)} things to do`;
            ctx.strokeText(line, sx, sy - 9);
            ctx.fillText(line, sx, sy - 9);
            ctx.strokeStyle = `rgba(255,211,107,${0.6 * a})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(sx, sy, 7 + 5 * k, 0, Math.PI * 2);
            ctx.stroke();
          } else whisper = null;
        }

        // The lit edge, on the side the light comes from.
        ctx.globalAlpha = fade * 0.55;
        const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
        rim.addColorStop(0, "rgba(160,200,255,0.9)");
        rim.addColorStop(0.5, "rgba(160,200,255,0)");
        ctx.strokeStyle = rim;
        ctx.lineWidth = Math.max(1, R / 120);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, [cities, land, home, homeP, mode]);

  // ---- Touch -------------------------------------------------------------------------------------
  const hit = (x: number, y: number): City | null => {
    const { R, cx, cy } = layout.current;
    if (sceneT.current < 1.4) return null;
    const tr = viewTrig(view.current);
    let best: City | null = null;
    let bd = 26 * 26;
    for (const c of cities) {
      const q = project(c.p, tr);
      if (q.z <= 0.05) continue;
      const dx = cx + q.x * R - x, dy = cy - q.y * R - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  const choose = (c: City | null) => {
    setPicked(c);
    pickedRef.current = c;
    aim.current = c;
    if (c) buzz(8);
  };
  const ripple = (x: number, y: number) => {
    const { R, cx, cy } = layout.current;
    const at = unproject((x - cx) / R, -(y - cy) / R, view.current);
    if (!at) return;
    ripples.current = [...ripples.current.slice(-3), { p: spherePoint(at.lat, at.lng), t: performance.now() }];
    buzz(5);
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === "splash") return leave();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0, t: performance.now() };
    vel.current = 0;
    aim.current = null;
    if (!touched) setTouched(true);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const { R } = layout.current;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const now = performance.now();
    const k = (180 / Math.PI / Math.max(60, R)) * 0.9;
    view.current.lng -= dx * k;
    view.current.lat = Math.max(-50, Math.min(65, view.current.lat + dy * k));
    vel.current = (dx * k) / Math.max(0.008, (now - d.t) / 1000);
    drag.current = { ...d, x: e.clientX, y: e.clientY, moved: d.moved + Math.abs(dx) + Math.abs(dy), t: now };
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (performance.now() - d.t > 90) vel.current = 0;
    if (d.moved >= 8) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const c = hit(x, y);
    if (c) choose(c);
    else {
      if (pickedRef.current) choose(null);
      ripple(x, y);
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const v = view.current;
    if (e.key === "ArrowLeft") v.lng -= 12;
    else if (e.key === "ArrowRight") v.lng += 12;
    else if (e.key === "ArrowUp") v.lat = Math.min(65, v.lat + 8);
    else if (e.key === "ArrowDown") v.lat = Math.max(-50, v.lat - 8);
    else if (e.key === "Enter" || e.key === " ") {
      const { cx, cy } = layout.current;
      const c = hit(cx, cy) ?? null;
      choose(c);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    aim.current = null;
    if (!touched) setTouched(true);
  };

  const pickedN = picked ? counts.current.get(picked.id) ?? 0 : 0;
  const hello = `${greeting(new Date().getHours())}${home.name ? `, ${home.name}` : ""}`;

  return createPortal(
    <div
      ref={root}
      className={`opening ${out ? "is-out" : ""} ${mode === "splash" ? "is-splash" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="opening-title"
      aria-describedby="opening-desc"
      tabIndex={-1}
    >
      <span className="opening-mark" aria-hidden>
        <MundiviMark size={44} ring="#0a1533" />
      </span>
      <canvas
        ref={canvas}
        className="opening-canvas"
        tabIndex={mode === "full" ? 0 : -1}
        aria-label="A planet at night, lighting up where things are on. Drag or use the arrow keys to turn it; tap a light to see what's on there."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKey}
      />

      {/* The bar: the name on the left, a way out on the right. */}
      <div className="opening-bar" data-on={stage >= 1 || mode === "splash" ? "" : undefined}>
        <span className="opening-logo">
          <MundiviMark size={26} ring="#0a1533" />
          <Wordmark />
        </span>
        {mode === "full" && (
          <button type="button" className="opening-skip" onClick={() => leave()}>
            Skip
          </button>
        )}
      </div>

      {/* How to play with it, shown by a hand rather than told in a box. */}
      {mode === "full" && stage >= 2 && !touched && !picked && (
        <>
          <span className="opening-gesture" aria-hidden>
            <span className="opening-touch" />
            <Hand size={30} strokeWidth={1.6} />
          </span>
          <p className="opening-caption" aria-hidden>
            Drag to spin · Tap a light
          </p>
        </>
      )}

      {mode === "full" && (
        <div className="opening-words" data-on={stage >= 1 ? "" : undefined} aria-live="polite">
          {picked ? (
            // The words become the place picked: its name, what's on, and the way there.
            <div key={picked.id} className="opening-copy is-place">
              <p className="opening-kicker">{picked.country}</p>
              <h2 id="opening-title" className="opening-title">{picked.name}</h2>
              <p id="opening-desc" className="opening-sub tnum">
                {pickedN > 0 ? `${fmt(pickedN)} things to do, from tonight on` : "Concerts, shows, sport and more"}
              </p>
              <div className="opening-actions">
                <button ref={goBtn} type="button" className="opening-go press" onClick={() => leave(picked)}>
                  Explore {picked.name} <ArrowRight size={18} aria-hidden />
                </button>
                <button type="button" className="opening-alt" onClick={() => choose(null)}>
                  Keep spinning
                </button>
              </div>
            </div>
          ) : (
            <div key="planet" className="opening-copy">
              <p className="opening-kicker">{hello}</p>
              <h2 id="opening-title" className="opening-title">
                One planet.
                <br />
                <em>Every experience.</em>
              </h2>
              <p id="opening-desc" className="opening-sub tnum">
                {total ? <>{fmt(shownTotal)} things to do around the world, right now.</> : <>Concerts, sport, shows and festivals, all on one planet.</>}
              </p>
              <div className="opening-actions">
                <button ref={goBtn} type="button" className="opening-go press" onClick={() => leave()}>
                  Start exploring <ArrowRight size={18} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {mode === "splash" && (
        <h2 id="opening-title" className="sr-only">
          Mundivi
        </h2>
      )}
    </div>,
    document.body,
  );
}
