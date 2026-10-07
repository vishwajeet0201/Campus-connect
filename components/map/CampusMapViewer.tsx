"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, SearchX } from "lucide-react";
import { clamp, screenToWorld } from "@/lib/campus";

export type MapFloor = {
  id: string;
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

const CATEGORY_STYLES: Record<string, { color: string; label: string }> = {
  classroom: { color: "var(--color-accent)", label: "Classroom" },
  lab: { color: "var(--color-orange)", label: "Lab" },
  conference: { color: "#7c6cff", label: "Conference" },
  staff_room: { color: "#7f8cff", label: "Staff" },
  toilet_men: { color: "#31b9ff", label: "Men" },
  toilet_women: { color: "#ff6ba6", label: "Women" },
  canteen: { color: "#34c759", label: "Canteen" },
  library: { color: "#8e5cff", label: "Library" },
  office: { color: "#6f9eff", label: "Office" },
  entrance: { color: "#00b894", label: "Entrance" },
  stairs: { color: "#a9b1ff", label: "Stairs" },
  lift: { color: "#00a6ff", label: "Lift" },
  ramp: { color: "#9ecc6d", label: "Ramp" },
  other: { color: "#8c8c93", label: "Other" },
};

export function CampusMapViewer({
  floors,
  pois,
  activeFloorId,
  selectedPoiId,
  onSelectPoi,
  categoryFilter,
  query,
  onMapTap,
  onPanningChange,
}: {
  floors: MapFloor[];
  pois: MapPoi[];
  activeFloorId: string;
  selectedPoiId?: string | null;
  onSelectPoi: (poi: MapPoi) => void;
  categoryFilter: string;
  query: string;
  onMapTap?: () => void;
  onPanningChange?: (isPanning: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredPoiId, setHoveredPoiId] = useState<string | null>(null);

  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0];
  const activePois = useMemo(() => {
    return pois.filter((poi) => poi.floor_id === activeFloorId && (categoryFilter === "all" || poi.category === categoryFilter || (categoryFilter === "toilets" && (poi.category === "toilet_men" || poi.category === "toilet_women"))));
  }, [pois, activeFloorId, categoryFilter]);

  const filteredPois = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return activePois;
    return activePois.filter((poi) => {
      const haystack = `${poi.name} ${poi.room_code ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [activePois, query]);

  const handleZoom = (nextZoom: number, originX?: number, originY?: number) => {
    const clamped = clamp(nextZoom, 0.75, 2.8);
    if (originX == null || originY == null) {
      setZoom(clamped);
      return;
    }
    const scaleRatio = clamped / zoom;
    setPan((current) => ({
      x: (current.x - originX) * scaleRatio + originX,
      y: (current.y - originY) * scaleRatio + originY,
    }));
    setZoom(clamped);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest("svg")) {
      return;
    }
    onMapTap?.();
    onPanningChange?.(true);
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      const now = Date.now();
      if ((event.currentTarget as HTMLDivElement).dataset.lastTapTime && now - Number((event.currentTarget as HTMLDivElement).dataset.lastTapTime) < 320) {
        handleZoom(clamp(zoom * 1.35, 0.75, 2.8), rect.width / 2, rect.height / 2);
        (event.currentTarget as HTMLDivElement).dataset.lastTapTime = String(0);
      } else {
        (event.currentTarget as HTMLDivElement).dataset.lastTapTime = String(now);
      }
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.originX + dx / zoom, y: dragRef.current.originY + dy / zoom });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      onPanningChange?.(false);
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const nextZoom = clamp(zoom * (event.deltaY < 0 ? 1.12 : 0.88), 0.75, 2.8);
    const world = screenToWorld(rawX, rawY, rect.width, rect.height, zoom, pan.x, pan.y);
    const nextPan = {
      x: (world.x - rect.width / 2) * (1 - nextZoom / zoom) + pan.x,
      y: (world.y - rect.height / 2) * (1 - nextZoom / zoom) + pan.y,
    };
    setZoom(nextZoom);
    setPan(nextPan);
  };

  const focusPoi = (poi: MapPoi) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const world = { x: poi.x, y: poi.y };
    const targetX = (world.x - rect.width / 2) * 1.1;
    const targetY = (world.y - rect.height / 2) * 1.1;
    setPan({ x: targetX, y: targetY });
    setZoom(1.4);
    onSelectPoi(poi);
  };

  const touchStyle = useMemo(() => ({
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: "center center",
    willChange: "transform",
    touchAction: "none",
  }), [pan.x, pan.y, zoom]);

  if (!activeFloor) {
    return <div className="campus-empty-state"><SearchX className="h-5 w-5" /> <span>No map floor available.</span></div>;
  }

  return (
    <div className="campus-map-shell">
      <div ref={containerRef} className="campus-map-view" data-zoomed={zoom > 1.05} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel} role="application" aria-label="Campus map viewer">
        <div className="campus-map-matrix" style={touchStyle}>
          <img src={activeFloor.svg_path} alt={`${activeFloor.name} floor plan`} className="campus-map-image" />
          {filteredPois.map((poi) => {
            const style = CATEGORY_STYLES[poi.category ?? "other"] ?? CATEGORY_STYLES.other;
            const isSelected = selectedPoiId === poi.id;
            const isHovered = hoveredPoiId === poi.id;
            return (
              <motion.button
                key={poi.id}
                type="button"
                className="poi-marker"
                style={{
                  left: `${(poi.x / activeFloor.width) * 100}%`,
                  top: `${(poi.y / activeFloor.height) * 100}%`,
                  background: style.color,
                  boxShadow: isSelected ? `0 0 0 10px ${style.color}22` : `0 0 0 6px rgba(255,255,255,0.15)`,
                  opacity: isSelected || isHovered || !query ? 1 : 0.85,
                }}
                onClick={() => focusPoi(poi)}
                onMouseEnter={() => setHoveredPoiId(poi.id)}
                onMouseLeave={() => setHoveredPoiId(null)}
                aria-label={poi.name}
                whileTap={{ scale: 0.9 }}
              >
                <span className="poi-marker-inner" />
                <span className="poi-marker-label">{poi.name}</span>
              </motion.button>
            );
          })}
        </div>
        <div className="map-zoom-badge">{zoom.toFixed(2)}x</div>
      </div>
      <AnimatePresence>
        {filteredPois.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="map-empty-state">
            <MapPin className="h-5 w-5" />
            <span>No POIs found for this floor.</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
