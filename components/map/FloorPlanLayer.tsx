"use client";

import { memo } from "react";
import type { FloorPlan, PlanRoom, Ring, Side } from "@/lib/maps/types";
import type { PlanRoute } from "@/lib/maps/routing";

/** Colours of the source campus map, kept so the plan reads the same. */
export const PLAN_COLORS = {
  background: "#ffffff",
  room: "#bfe4ff",
  roomStroke: "#4f5d6b",
  corridor: "#f3dbab",
  open: "#ffeed0",
  passage: "#dfedf8",
  field: "#b2ff9f",
  garden: "#3eaf23",
  gate: "#726ffe",
  stairs: "#f26061",
  door: "#1f2937",
  ink: "#172130",
} as const;

const MIN_LABEL_PX = 10; // labels are never drawn smaller than this on screen
const GLYPH_EM = 0.56; // average glyph advance of the UI font, in em

/** Size to draw a label at (map units) so it is at least MIN_LABEL_PX on
 * screen, or null when it wouldn't fit inside its box at that size. */
function fitLabel(lines: string[], size: number, box: { w: number; h: number }, scale: number) {
  const s = Math.max(size, MIN_LABEL_PX / scale);
  const widest = Math.max(...lines.map((line) => line.length)) * GLYPH_EM * s;
  const tall = (lines.length * 1.22 - 0.22) * s;
  return widest <= box.w * 0.94 && tall <= box.h * 0.94 ? s : null;
}

const ringPath = (rings: Ring[]) => rings.map((ring) => `M${ring.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");

function roomPath(room: PlanRoom) {
  if (room.shape.type === "rect") {
    const { x, y, w, h } = room.shape;
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
  return ringPath([room.shape.points]);
}

/** Fade an edge no screenshot shows, so the block reads as continuing. */
function UnseenEdges({ id, box, sides }: { id: string; box: [number, number, number, number]; sides: Side[] }) {
  const [x, y, w, h] = box;
  return <>{sides.map((side) => {
    const horizontal = side === "left" || side === "right";
    // Never deeper than half the block across that side, so a shallow block keeps most of its fill.
    const depth = Math.min(160, Math.max(w, h) * 0.15, (horizontal ? w : h) * 0.5);
    const gid = `unseen-${id}-${side}`;
    const rect = side === "right" ? { x: x + w - depth, y, width: depth, height: h }
      : side === "left" ? { x, y, width: depth, height: h }
        : side === "bottom" ? { x, y: y + h - depth, width: w, height: depth }
          : { x, y, width: w, height: depth };
    const toEdge = side === "right" || side === "bottom";
    return <g key={side} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1={horizontal ? (toEdge ? 0 : 1) : 0} y1={horizontal ? 0 : (toEdge ? 0 : 1)} x2={horizontal ? (toEdge ? 1 : 0) : 0} y2={horizontal ? 0 : (toEdge ? 1 : 0)}>
          <stop offset="0" stopColor={PLAN_COLORS.background} stopOpacity="0" />
          <stop offset="1" stopColor={PLAN_COLORS.background} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect {...rect} fill={`url(#${gid})`} />
    </g>;
  })}</>;
}

function Label({ x, y, size, lines, color = PLAN_COLORS.ink, weight = 400, rotate, halo }: { x: number; y: number; size: number; lines: string[]; color?: string; weight?: number; rotate?: number; halo?: string }) {
  const lead = size * 1.22;
  const top = y - ((lines.length - 1) * lead) / 2;
  // A halo keeps light text readable where it runs past its block (e.g. a notched garden).
  const haloProps = halo ? { stroke: halo, strokeWidth: size * 0.28, strokeLinejoin: "round" as const, paintOrder: "stroke" } : {};
  return <text className="plan-label" x={x} y={top} fontSize={size} fill={color} fontWeight={weight} textAnchor="middle" dominantBaseline="central" transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined} {...haloProps}>
    {lines.map((line, i) => <tspan key={i} x={x} y={top + i * lead}>{line.endsWith(" ♥") ? <>{line.slice(0, -2)} <tspan fill="#e0245e">♥</tspan></> : line}</tspan>)}
  </text>;
}

/** Static drawing of a floor: areas, rooms, doors, stairs, gates and labels. */
export const FloorPlanLayer = memo(function FloorPlanLayer({
  plan,
  scale,
  selectedId,
  highlight,
}: {
  plan: FloorPlan;
  /** Screen px per map px (quantised by the caller). */
  scale: number;
  selectedId?: string | null;
  /** Categories to emphasise (others dim); null shows everything normally. */
  highlight?: Set<string> | null;
}) {
  // Open places have no walls to fit inside; show them once they're at most 2.4x their drawn size.
  const placeSize = (size: number) => (MIN_LABEL_PX / scale <= size * 2.4 ? Math.max(size, MIN_LABEL_PX / scale) : null);
  const fieldPlaces = plan.places.filter((p) => p.area && p.bbox);
  return <g className="floor-plan" data-highlighting={highlight ? "true" : undefined}>
    <rect x={0} y={0} width={plan.floor.width} height={plan.floor.height} fill={PLAN_COLORS.background} />
    {/* Open areas first: corridors drawn inside them stay on top. */}
    {plan.areas.filter((a) => a.kind === "open").map((a, i) => <path key={`o${i}`} d={ringPath(a.rings)} fill={PLAN_COLORS.open} />)}
    {plan.areas.filter((a) => a.kind === "corridor").map((a, i) => <path key={`c${i}`} d={ringPath(a.rings)} fill={PLAN_COLORS.corridor} />)}
    {plan.areas.filter((a) => a.kind === "passage").map((a, i) => <path key={`p${i}`} d={ringPath(a.rings)} fill={PLAN_COLORS.passage} stroke={PLAN_COLORS.roomStroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}

    {fieldPlaces.map((place) => {
      const [x, y, w, h] = place.bbox!;
      const selected = selectedId === place.id;
      const dim = highlight && !highlight.has(place.category);
      const fill = place.area === "garden" ? PLAN_COLORS.garden : PLAN_COLORS.field;
      return <g key={place.id} data-feature={place.id} role="button" aria-label={place.name} className="plan-feature" data-selected={selected || undefined} data-dim={dim || undefined}>
        {place.rings ? <path d={ringPath(place.rings)} fill={fill} /> : <rect x={x} y={y} width={w} height={h} fill={fill} />}
        {place.unseenEdges && <UnseenEdges id={place.id} box={place.bbox!} sides={place.unseenEdges} />}
      </g>;
    })}

    {plan.rooms.map((room) => {
      const selected = selectedId === room.id;
      const dim = highlight && !(room.category && highlight.has(room.category));
      return <g key={room.id} data-feature={room.name ? room.id : undefined} role={room.name ? "button" : undefined} aria-label={room.name} className="plan-room" data-named={room.name ? "true" : undefined} data-selected={selected || undefined} data-dim={dim || undefined}>
        <path d={roomPath(room)} fill={PLAN_COLORS.room} stroke={PLAN_COLORS.roomStroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {room.unseenEdges && <UnseenEdges id={room.id} box={room.bbox} sides={room.unseenEdges} />}
      </g>;
    })}

    {plan.doors.map((d, i) => <rect key={i} x={d.x - d.w / 2} y={d.y - d.h / 2} width={d.w} height={d.h} fill={PLAN_COLORS.door} rx={0.8} aria-hidden="true" />)}

    <defs>
      <pattern id="stair-treads" width="7" height="7" patternUnits="userSpaceOnUse">
        <rect width="7" height="7" fill={PLAN_COLORS.stairs} />
        <rect width="1.2" height="7" fill="#8f2f33" />
      </pattern>
    </defs>
    {plan.stairs.map((s) => <path key={s.id} d={ringPath(s.rings)} fill="url(#stair-treads)" stroke="#8f2f33" strokeWidth={1} vectorEffect="non-scaling-stroke" aria-label="Stairs" />)}

    {plan.gates.map((g) => {
      const [x, y, w, h] = g.bbox;
      return <g key={g.id} data-feature={g.id} role="button" aria-label={g.name} className="plan-feature" data-selected={selectedId === g.id || undefined}>
        <rect x={x} y={y} width={w} height={h} fill={PLAN_COLORS.gate} />
        {(() => {
          const turned = g.label.rotate === 90 || g.label.rotate === -90;
          const size = fitLabel([g.name], g.label.size, turned ? { w: h, h: w } : { w, h }, scale);
          return size && <Label x={g.label.x} y={g.label.y} size={size} lines={[g.name]} color="#ffffff" rotate={g.label.rotate} />;
        })()}
      </g>;
    })}

    <g className="plan-labels" aria-hidden="true">
      {plan.rooms.map((room) => {
        if (!room.name || !room.label || !room.lines) return null;
        const selected = selectedId === room.id;
        const size = fitLabel(room.lines, room.label.size, { w: room.bbox[2], h: room.bbox[3] }, scale) ?? (selected ? Math.max(room.label.size, MIN_LABEL_PX / scale) : null);
        return size ? <Label key={room.id} x={room.label.x} y={room.label.y} size={size} lines={room.lines} weight={selected ? 700 : 400} /> : null;
      })}
      {plan.places.map((place) => {
        if (!place.label) return null;
        const selected = selectedId === place.id;
        const size = place.bbox ? fitLabel(place.label.lines, place.label.size, { w: place.bbox[2], h: place.bbox[3] }, scale) : placeSize(place.label.size);
        const shown = size ?? (selected ? Math.max(place.label.size, MIN_LABEL_PX / scale) : null);
        return shown ? <Label key={place.id} x={place.label.x} y={place.label.y} size={shown} lines={place.label.lines} color={place.area === "garden" ? "#ffffff" : PLAN_COLORS.ink} halo={place.area === "garden" ? PLAN_COLORS.garden : undefined} weight={selected ? 700 : 400} /> : null;
      })}
    </g>
    {/* Open places are tappable by their label. */}
    {plan.places.filter((p) => !p.area && p.label).map((place) => {
      const size = place.label!.size;
      const w = Math.max(...place.label!.lines.map((l) => l.length)) * size * 0.6;
      const h = place.label!.lines.length * size * 1.3;
      return <rect key={place.id} data-feature={place.id} role="button" aria-label={place.name} x={place.label!.x - w / 2 - 20} y={place.label!.y - h / 2 - 20} width={w + 40} height={h + 40} fill="transparent" />;
    })}
  </g>;
});

/** The planned walk, with the current step emphasised. */
export function RouteLayer({ route, step, scale }: { route: PlanRoute; step: number; scale: number }) {
  const pts = route.points;
  const seg = (from: number, to: number) => pts.slice(from, to + 1).map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("");
  // Indoor and outdoor runs are drawn separately so outdoor stretches can be dashed.
  const runs: { from: number; to: number; outdoor: boolean }[] = [];
  route.outdoor.forEach((outdoor, i) => {
    const last = runs[runs.length - 1];
    if (last && last.outdoor === outdoor) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, outdoor });
  });
  const active = route.steps[Math.min(Math.max(step, 0), route.steps.length - 1)];
  const marker = 1 / scale; // keep markers a constant on-screen size
  const start = pts[0];
  const end = pts[pts.length - 1];
  return <g className="plan-route" aria-hidden="true">
    {runs.map((r, i) => <path key={`casing${i}`} d={seg(r.from, r.to)} className="plan-route-casing" vectorEffect="non-scaling-stroke" />)}
    {runs.map((r, i) => <path key={`line${i}`} d={seg(r.from, r.to)} className="plan-route-line" data-outdoor={r.outdoor || undefined} vectorEffect="non-scaling-stroke" />)}
    {active && active.end > active.start && <path d={seg(active.start, active.end)} className="plan-route-active" vectorEffect="non-scaling-stroke" />}
    <g transform={`translate(${start.x} ${start.y}) scale(${marker})`}><circle r={9} className="plan-route-start" /></g>
    <g transform={`translate(${end.x} ${end.y}) scale(${marker})`}>
      <path d="M0 0 C-3 -9 -11 -13 -11 -22 A11 11 0 1 1 11 -22 C11 -13 3 -9 0 0Z" className="plan-route-end" />
      <circle cy={-22} r={4} fill="#ffffff" />
    </g>
    {active && <g transform={`translate(${pts[active.end].x} ${pts[active.end].y}) scale(${marker})`}><circle r={12} className="plan-route-target" /></g>}
  </g>;
}
