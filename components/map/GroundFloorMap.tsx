"use client";

import { useMemo, useState } from "react";
import { GROUND_FLOOR_EDGES, GROUND_FLOOR_NODES, GROUND_FLOOR_ROOMS, type GroundFloorRoom } from "@/lib/ground-floor";

const WIDTH = 6072;
const HEIGHT = 1510;

export function GroundFloorMap({ routeNodeIds, routeStep = 0 }: { routeNodeIds?: string[] | null; routeStep?: number }) {
  const [selected, setSelected] = useState<GroundFloorRoom | null>(null);
  const nodes = useMemo(() => new Map(GROUND_FLOOR_NODES.map((node) => [node.id, node])), []);
  const routePoints = useMemo(() => (routeNodeIds ?? []).map((id) => nodes.get(id)).filter((node) => node !== undefined), [nodes, routeNodeIds]);
  const toPoints = (list: typeof routePoints) => list.map((node) => `${node.x},${node.y}`).join(" ");
  const routeEndpoints = new Set([routeNodeIds?.[0], routeNodeIds?.at(-1)].map((id) => id?.replace(/^room-/, "")));

  return <svg className="ground-floor-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Interactive VJTI main building ground floor map">
    <rect width={WIDTH} height={HEIGHT} fill="#f4f0e7" />
    <g className="ground-floor-edges" aria-hidden="true">{GROUND_FLOOR_EDGES.map((edge) => { const from = nodes.get(edge.from); const to = nodes.get(edge.to); return from && to ? <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={edge.accessible ? "ground-edge" : "ground-edge ground-edge--stairs"} /> : null; })}</g>
    <g className="ground-floor-rooms">{GROUND_FLOOR_ROOMS.map((room) => <g key={room.id} role="button" tabIndex={0} aria-label={room.name} className={`ground-room ground-room--${room.kind ?? "room"}${selected?.id === room.id || routeEndpoints.has(room.id) ? " ground-room--selected" : ""}`} onClick={() => setSelected(room)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(room); }}><rect x={room.x} y={room.y} width={room.width} height={room.height} rx={room.kind === "open" ? 26 : 8} /><text x={room.x + room.width / 2} y={room.y + room.height / 2} textAnchor="middle" dominantBaseline="middle">{room.name}</text></g>)}</g>
    <g className="ground-floor-nodes">{GROUND_FLOOR_NODES.filter((node) => node.kind !== "room").map((node) => <g key={node.id} transform={`translate(${node.x} ${node.y})`} className={`ground-node ground-node--${node.kind}`}><circle r="28" /><text y="58" textAnchor="middle">{node.kind}</text></g>)}</g>
    {routePoints.length > 1 && <g className="ground-route" aria-hidden="true">
      <polyline className="ground-route-line" points={toPoints(routePoints)} />
      <polyline className="ground-route-line ground-route-line--active" points={toPoints(routePoints.slice(Math.max(0, routeStep - 1), routeStep + 1))} />
      <circle className="ground-route-start" cx={routePoints[0].x} cy={routePoints[0].y} r="38" />
      <circle className="ground-route-end" cx={routePoints.at(-1)!.x} cy={routePoints.at(-1)!.y} r="44" />
      {routePoints[routeStep] && <circle className="ground-route-target" cx={routePoints[routeStep].x} cy={routePoints[routeStep].y} r="30" />}
    </g>}
    {selected && <g className="ground-room-callout" transform={`translate(${Math.min(selected.x + selected.width + 30, WIDTH - 680)} ${Math.max(40, selected.y - 20)})`}><rect width="640" height="150" rx="20" /><text x="28" y="55">{selected.name}</text><text x="28" y="100">Tap another room to inspect it</text></g>}
  </svg>;
}
