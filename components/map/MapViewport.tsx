"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

export type Box = { x: number; y: number; w: number; h: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type MapController = {
  /** Fit a box (default: the whole map) into the unobstructed part of the viewport. */
  fit: (box?: Box, animate?: boolean) => void;
  /** Centre a box, zooming in only as far as needed to show it comfortably. */
  focus: (box: Box) => void;
  zoomBy: (factor: number) => void;
};

type Camera = { cx: number; cy: number; k: number };

const MAX_SCALE = 3; // screen px per map px
const OVERSCROLL = 48; // px the map may be dragged past the edge of the visible region
const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 320;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Pan/zoom viewport for a floor drawn in its own pixel coordinates. The camera
 * is the SVG viewBox, so vector content stays crisp at every zoom level.
 * Gestures: drag to pan, pinch / wheel / double-tap to zoom, keyboard +/-/0/arrows.
 */
export function MapViewport({
  width,
  height,
  insets,
  controllerRef,
  onScale,
  onTap,
  onGesture,
  label,
  children,
}: {
  width: number;
  height: number;
  insets: Insets;
  controllerRef?: Ref<MapController>;
  /** Called (throttled to frames) with the current screen-px-per-map-px scale. */
  onScale?: (k: number) => void;
  /** A tap that wasn't a drag: the element tapped and the map point under it. */
  onTap?: (target: Element, point: { x: number; y: number }) => void;
  onGesture?: (active: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cam = useRef<Camera>({ cx: width / 2, cy: height / 2, k: 0.1 });
  const size = useRef({ w: 1, h: 1 });
  const insetsRef = useRef(insets);
  const animation = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const laidOut = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // What the camera was last asked to frame (the floor, a feature, a route),
  // as a function of the insets, until the user pans or zooms themselves.
  const framing = useRef<(() => Camera) | null>(null);

  const limits = useCallback(() => {
    const { w, h } = size.current;
    const i = insetsRef.current;
    const fitK = Math.min(Math.max(w - i.left - i.right, 1) / width, Math.max(h - i.top - i.bottom, 1) / height);
    return { min: fitK * 0.8, max: Math.max(MAX_SCALE, fitK * 2) };
  }, [width, height]);

  const clamp = useCallback((c: Camera): Camera => {
    const { min, max } = limits();
    const k = Math.min(max, Math.max(min, c.k));
    const { w, h } = size.current;
    const i = insetsRef.current;
    // Along one axis: keep the map covering the unobstructed region [lo, view - hi]
    // (allowing OVERSCROLL px of slack), or centre it there when it's smaller.
    const axis = (centre: number, mapLength: number, view: number, lo: number, hi: number) => {
      const r0 = lo;
      const r1 = view - hi;
      const least = (view / 2 - r0 - OVERSCROLL) / k;
      const most = mapLength - (r1 - OVERSCROLL - view / 2) / k;
      if (least > most) return mapLength / 2 - ((r0 + r1) / 2 - view / 2) / k;
      return Math.min(most, Math.max(least, centre));
    };
    return { k, cx: axis(c.cx, width, w, i.left, i.right), cy: axis(c.cy, height, h, i.top, i.bottom) };
  }, [limits, width, height]);

  const apply = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { w, h } = size.current;
    const { cx, cy, k } = cam.current;
    svg.setAttribute("viewBox", `${cx - w / (2 * k)} ${cy - h / (2 * k)} ${w / k} ${h / k}`);
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        onScale?.(cam.current.k);
      });
    }
  }, [onScale]);

  const set = useCallback((c: Camera) => {
    cam.current = clamp(c);
    apply();
  }, [apply, clamp]);

  const stopAnimation = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };

  const animateTo = useCallback((target: Camera) => {
    stopAnimation();
    const goal = clamp(target);
    if (prefersReducedMotion()) return set(goal);
    const start = { ...cam.current };
    const t0 = performance.now();
    const duration = 420;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // Interpolate zoom geometrically so it feels even.
      const k = start.k * Math.pow(goal.k / start.k, e);
      set({ k, cx: start.cx + (goal.cx - start.cx) * e, cy: start.cy + (goal.cy - start.cy) * e });
      animation.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  }, [clamp, set]);

  /** Camera centred on the unobstructed region, showing `box`. */
  const cameraFor = useCallback((box: Box, maxK?: number): Camera => {
    const { w, h } = size.current;
    const i = insetsRef.current;
    const vw = Math.max(w - i.left - i.right, 1);
    const vh = Math.max(h - i.top - i.bottom, 1);
    let k = Math.min(vw / box.w, vh / box.h);
    if (maxK) k = Math.min(k, maxK);
    // The visible region's centre is offset from the screen centre by the insets.
    const offX = (i.left - i.right) / 2;
    const offY = (i.top - i.bottom) / 2;
    return { k, cx: box.x + box.w / 2 - offX / k, cy: box.y + box.h / 2 - offY / k };
  }, []);

  const zoomAround = useCallback((sx: number, sy: number, factor: number, animate = false) => {
    framing.current = null;
    const { w, h } = size.current;
    const c = cam.current;
    const mx = c.cx + (sx - w / 2) / c.k;
    const my = c.cy + (sy - h / 2) / c.k;
    const { min, max } = limits();
    const k = Math.min(max, Math.max(min, c.k * factor));
    const next = { k, cx: mx - (sx - w / 2) / k, cy: my - (sy - h / 2) / k };
    if (animate) animateTo(next);
    else set(next);
  }, [animateTo, limits, set]);

  useImperativeHandle(controllerRef, () => ({
    fit: (box, animate = true) => {
      framing.current = () => cameraFor(box ?? { x: 0, y: 0, w: width, h: height });
      if (animate) animateTo(framing.current());
      else set(framing.current());
    },
    focus: (box) => {
      // Pad the box and stop at a readable zoom rather than filling the screen.
      const pad = Math.max(box.w, box.h) * 0.9 + 120;
      framing.current = () => cameraFor({ x: box.x - pad / 2, y: box.y - pad / 2, w: box.w + pad, h: box.h + pad }, 1.6);
      animateTo(framing.current());
    },
    zoomBy: (factor) => {
      // Zoom about the middle of the unobstructed region, not the whole screen.
      const { w, h } = size.current;
      const i = insetsRef.current;
      zoomAround((i.left + w - i.right) / 2, (i.top + h - i.bottom) / 2, factor, true);
    },
  }), [animateTo, cameraFor, height, set, width, zoomAround]);

  // Track the viewport size; fit the floor on first layout.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      size.current = { w: Math.max(rect.width, 1), h: Math.max(rect.height, 1) };
      if (first) {
        first = false;
        laidOut.current = true;
        framing.current = () => cameraFor({ x: 0, y: 0, w: width, h: height });
        cam.current = clamp(framing.current());
        setReady(true);
      } else {
        cam.current = clamp(framing.current ? framing.current() : cam.current);
      }
      apply();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [apply, cameraFor, clamp, height, width]);

  // When overlays come and go (a sheet opens, the story row collapses), keep
  // whatever was framed framed in the space that's left; otherwise just keep
  // the map covering it.
  useEffect(() => {
    insetsRef.current = insets;
    if (!laidOut.current) return;
    // Mid-gesture, only keep the map covering the new region; never animate under a finger.
    if (framing.current && pointers.current.size === 0) animateTo(framing.current());
    else set(cam.current);
  }, [insets, animateTo, set]);

  useEffect(() => () => {
    stopAnimation();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  // Pointer gestures: one pointer pans, two pinch-zoom around their midpoint.
  const gesture = useRef<{ start: Camera; x: number; y: number; dist: number; moved: boolean; t: number; target: Element | null } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const beginGesture = (target: Element | null) => {
    const pts = [...pointers.current.values()];
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { start: { ...cam.current }, x, y, dist, moved: gesture.current?.moved ?? false, t: gesture.current?.t ?? performance.now(), target: gesture.current?.target ?? target };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    stopAnimation();
    hostRef.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 1) {
      gesture.current = null;
      onGesture?.(true);
    }
    beginGesture(event.target as Element);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, local(event));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (!g.moved && (Math.hypot(x - g.x, y - g.y) > TAP_SLOP || pts.length > 1)) {
      // The user has taken over: drop any framing and any reframe in flight.
      g.moved = true;
      framing.current = null;
      stopAnimation();
    }
    const { w, h } = size.current;
    let k = g.start.k;
    if (pts.length > 1 && g.dist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const { min, max } = limits();
      k = Math.min(max, Math.max(min, g.start.k * (dist / g.dist)));
    }
    // Keep the map point that was under the gesture centre under it now.
    const mx = g.start.cx + (g.x - w / 2) / g.start.k;
    const my = g.start.cy + (g.y - h / 2) / g.start.k;
    set({ k, cx: mx - (x - w / 2) / k, cy: my - (y - h / 2) / k });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // A finger lifted mid-pinch: carry on panning from where we are.
      beginGesture(null);
      return;
    }
    onGesture?.(false);
    gesture.current = null;
    if (!g || g.moved || performance.now() - g.t > 500) return;
    const now = performance.now();
    const previous = lastTap.current;
    if (previous && now - previous.t < DOUBLE_TAP_MS && Math.hypot(point.x - previous.x, point.y - previous.y) < 30) {
      lastTap.current = null;
      zoomAround(point.x, point.y, 2, true);
      return;
    }
    lastTap.current = { t: now, x: point.x, y: point.y };
    const { w, h } = size.current;
    const c = cam.current;
    if (g.target) onTap?.(g.target, { x: c.cx + (point.x - w / 2) / c.k, y: c.cy + (point.y - h / 2) / c.k });
  };

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopAnimation();
      const rect = host.getBoundingClientRect();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAround(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-delta * 0.0018));
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { w, h } = size.current;
    const step = 80 / cam.current.k;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "+" || event.key === "=") zoomAround(w / 2, h / 2, 1.5, true);
    else if (event.key === "-") zoomAround(w / 2, h / 2, 1 / 1.5, true);
    else if (event.key === "0") {
      framing.current = () => cameraFor({ x: 0, y: 0, w: width, h: height });
      animateTo(framing.current());
    } else if (moves[event.key]) {
      framing.current = null;
      animateTo({ ...cam.current, cx: cam.current.cx + moves[event.key][0], cy: cam.current.cy + moves[event.key][1] });
    }
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={hostRef}
      className="map-viewport"
      role="application"
      aria-label={label}
      aria-roledescription="interactive map. Drag to pan, pinch or use plus and minus to zoom, 0 to show the whole floor"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      data-ready={ready}
    >
      <svg ref={svgRef} className="map-viewport-svg" preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${width} ${height}`}>
        {children}
      </svg>
    </div>
  );
}
