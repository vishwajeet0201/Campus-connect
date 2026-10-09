"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Minus, Plus, Scan } from "lucide-react";
import { imageFor, planFor } from "@/lib/maps";
import type { FloorPlan } from "@/lib/maps/types";
import type { PlanRoute } from "@/lib/maps/routing";
import { FloorPlanLayer, RouteLayer } from "./FloorPlanLayer";
import { MapViewport, type Box, type Insets, type MapController } from "./MapViewport";

export type MapFloor = {
  id: string;
  building_id?: string;
  building_code?: string;
  building_name?: string;
  code: string;
  name: string;
  sort_order: number;
  svg_path: string;
  width: number;
  height: number;
};

export type MapPoi = {
  id: string;
  floor_id: string;
  building_id?: string;
  building_code?: string;
  building_name?: string;
  category_id: string;
  name: string;
  description?: string | null;
  room_code?: string | null;
  x: number;
  y: number;
  opening_hours?: string | null;
  is_accessible: boolean;
  category?: string;
  floor_code?: string;
};

/** Filter chips -> floor-plan categories they emphasise. */
export const FILTER_CATEGORIES: Record<string, string[]> = {
  classroom: ["room", "hall"],
  lab: ["lab"],
  toilets: ["washroom_men", "washroom_women"],
  canteen: ["food"],
  library: ["library"],
  office: ["office", "faculty"],
};

const quantise = (k: number) => Math.pow(2, Math.round(Math.log2(k) * 4) / 4);

/** Bounding box of a named feature on a plan, for focusing the camera. */
export function featureBox(plan: FloorPlan, id: string): Box | null {
  const room = plan.rooms.find((r) => r.id === id);
  if (room) return { x: room.bbox[0], y: room.bbox[1], w: room.bbox[2], h: room.bbox[3] };
  const place = plan.places.find((p) => p.id === id);
  if (place?.bbox) return { x: place.bbox[0], y: place.bbox[1], w: place.bbox[2], h: place.bbox[3] };
  if (place) return { x: place.x - 120, y: place.y - 80, w: 240, h: 160 };
  const gate = plan.gates.find((g) => g.id === id);
  if (gate) return { x: gate.bbox[0], y: gate.bbox[1], w: gate.bbox[2], h: gate.bbox[3] };
  return null;
}

function boxOf(points: { x: number; y: number }[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(Math.max(...xs) - x, 1), h: Math.max(Math.max(...ys) - y, 1) };
}

export function CampusMapViewer({
  floors,
  pois,
  activeFloorId,
  insets,
  selectedFeatureId,
  onSelectFeature,
  focusRequest,
  selectedPoiId,
  onSelectPoi,
  categoryFilter,
  onPanningChange,
  route,
  routeStep = 0,
}: {
  floors: MapFloor[];
  pois: MapPoi[];
  activeFloorId: string;
  insets: Insets;
  selectedFeatureId?: string | null;
  onSelectFeature: (id: string | null) => void;
  /** Change `nonce` to fly to `id` again. */
  focusRequest?: { id: string; nonce: number } | null;
  selectedPoiId?: string | null;
  onSelectPoi: (poi: MapPoi | null) => void;
  categoryFilter: string;
  onPanningChange?: (isPanning: boolean) => void;
  route?: PlanRoute | null;
  routeStep?: number;
}) {
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0];
  const plan = planFor(activeFloor?.building_code, activeFloor?.code);
  const image = plan ? null : imageFor(activeFloor?.building_code, activeFloor?.code);
  const controller = useRef<MapController | null>(null);
  const [scale, setScale] = useState(0.1);
  const onScale = useCallback((k: number) => setScale((current) => (quantise(k) === current ? current : quantise(k))), []);

  const highlight = useMemo(() => (categoryFilter === "all" ? null : new Set(FILTER_CATEGORIES[categoryFilter] ?? [categoryFilter])), [categoryFilter]);
  const matches = plan && highlight ? plan.rooms.filter((r) => r.category && highlight.has(r.category)).length + plan.places.filter((p) => highlight.has(p.category)).length : null;

  // Only floors without a real plan or image fall back to the seeded markers.
  const fallbackPois = useMemo(() => (plan || (image && image.width) ? [] : pois.filter((poi) => poi.floor_id === activeFloor?.id && (categoryFilter === "all" || poi.category === categoryFilter || (categoryFilter === "toilets" && (poi.category === "toilet_men" || poi.category === "toilet_women"))))), [activeFloor?.id, categoryFilter, image, plan, pois]);

  useEffect(() => {
    if (!plan || !focusRequest) return;
    const box = featureBox(plan, focusRequest.id);
    if (box) controller.current?.focus(box);
  }, [focusRequest, plan]);

  // Show the whole walk when a route appears, then follow its steps.
  useEffect(() => {
    if (!plan || !route) return;
    const step = route.steps[routeStep];
    const points = routeStep > 0 && step && step.end > step.start ? route.points.slice(step.start, step.end + 1) : route.points;
    const box = boxOf(points);
    const pad = 140;
    controller.current?.fit({ x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad });
  }, [plan, route, routeStep]);

  if (!activeFloor) {
    return <div className="campus-empty-state"><Info className="h-5 w-5" /> <span>No map floor available.</span></div>;
  }

  const width = plan?.floor.width ?? (image?.width || activeFloor.width);
  const height = plan?.floor.height ?? (image?.height || activeFloor.height);
  const label = `${activeFloor.building_name ?? activeFloor.building_code ?? "Campus"} ${activeFloor.name} map`;
  const src = image?.width ? image.src : activeFloor.svg_path;

  return (
    <div className="campus-map-shell">
      <MapViewport
        key={activeFloor.id}
        width={width}
        height={height}
        insets={insets}
        controllerRef={controller}
        onScale={onScale}
        onGesture={(active) => onPanningChange?.(active)}
        onTap={(target) => {
          const feature = target.closest("[data-feature]")?.getAttribute("data-feature") ?? null;
          const poi = target.closest("[data-poi]")?.getAttribute("data-poi") ?? null;
          if (poi) onSelectPoi(pois.find((p) => p.id === poi) ?? null);
          else onSelectFeature(feature);
        }}
        label={label}
      >
        {plan ? (
          <>
            <FloorPlanLayer plan={plan} scale={scale} selectedId={selectedFeatureId} highlight={highlight} />
            {route && <RouteLayer route={route} step={routeStep} scale={scale} />}
          </>
        ) : (
          <>
            <rect width={width} height={height} fill="#ffffff" />
            {src && <image href={src} width={width} height={height} preserveAspectRatio="none" />}
            {fallbackPois.map((poi) => (
              <g key={poi.id} data-poi={poi.id} role="button" aria-label={poi.name} transform={`translate(${poi.x} ${poi.y}) scale(${1 / scale})`} className="plan-poi" data-selected={selectedPoiId === poi.id || undefined}>
                <circle r={9} />
              </g>
            ))}
          </>
        )}
      </MapViewport>

      <div className="map-zoom-controls" style={{ bottom: `${insets.bottom + 12}px` }}>
        <button type="button" aria-label="Zoom in" onClick={() => controller.current?.zoomBy(1.6)}><Plus className="h-4 w-4" /></button>
        <button type="button" aria-label="Zoom out" onClick={() => controller.current?.zoomBy(1 / 1.6)}><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label="Show whole floor" onClick={() => controller.current?.fit()}><Scan className="h-4 w-4" /></button>
      </div>

      {image?.partial && <p className="map-notice" style={{ top: `${insets.top + 8}px`, left: `${insets.left}px`, right: `${insets.right}px` }} role="note">{image.partial}</p>}
      {matches === 0 && <p className="map-notice" style={{ top: `${insets.top + 8}px`, left: `${insets.left}px`, right: `${insets.right}px` }} role="status">Nothing of this kind on this floor.</p>}
    </div>
  );
}
