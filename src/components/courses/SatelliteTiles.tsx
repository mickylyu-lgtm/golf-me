import { useEffect, useMemo, useRef, useState } from "react";
import { TileBudget, tileMosaic, tileZoomFor, type TileSource } from "../../lib/satelliteTiles";
import { stillFraming, type CourseBounds } from "../../../supabase/functions/_shared/courseBounds.ts";
import { imageRectInView, type MercBox } from "../../lib/naipExport";

// One budget for the whole app session (see TileBudget): distinct tile URLs
// per minute across every thumbnail and still view.
const budget = new TileBudget();

interface SatelliteTilesProps {
  /** Where the tiles come from (USGS NAIP, or MapTiler when keyed). */
  source: TileSource;
  /** The course's point (fallback centre). */
  lat: number;
  lng: number;
  /** The course's OSM outline: when known the view frames it. */
  bounds?: CourseBounds | null;
  /** Zoom used without an outline. */
  fallbackZoom: number;
  /** Size of the view in CSS px. */
  width: number;
  height: number;
  onError?: () => void;
  /** Course page still view only (never lists): the one sharp NAIP picture,
   * already downloaded by the parent (lib/courseDetailImagery), laid over
   * the tiles. */
  detail?: StillDetail | null;
  /** The tiles failed (the parent saw an error) but the picture may still
   * show. */
  tilesBroken?: boolean;
}

export interface StillDetail {
  bbox: MercBox;
  /** blob: URL from loadDetailPicture (one download, shared). */
  objectUrl: string;
  /** Arrived late: fade it in. */
  fade: boolean;
}

// A still aerial view drawn from a few raster tiles (see
// lib/satelliteTiles.ts): no map library, no WebGL, no map session. Frames
// the course outline when one is known, else centres on the point a bit
// wide. Above the source's deepest zoom (USGS: 16) tiles are scaled up.
// Fills its positioned parent. Tiles are lazy <img>s, so only views on
// screen load them; the browser caches them.
export function SatelliteTiles({ source, lat, lng, bounds, fallbackZoom, width, height, onError, detail, tilesBroken = false }: SatelliteTilesProps) {
  const tiles = useMemo(() => {
    const f = stillFraming({ lat, lng }, bounds, width, height, fallbackZoom);
    const { z, tilePx } = tileZoomFor(f.zoom, source.maxZoom);
    const list = tileMosaic({ lat: f.lat, lng: f.lng, zoom: z, width, height, tilePx }).map((t) => ({ ...t, src: source.url(t.z, t.x, t.y) }));
    // The zoom the tiles are actually drawn at (tileZoomFor may hold it).
    return { tilePx, list, view: { lat: f.lat, lng: f.lng, zoom: z + Math.log2(tilePx / 256), width, height } };
  }, [source, lat, lng, bounds, fallbackZoom, width, height]);
  const detailRect = detail ? imageRectInView(tiles.view, detail.bbox) : null;
  // Asked once per set of tiles, not per render.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const urlsKey = tiles.list.map((t) => t.src).join("|");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    if (!urlsKey) return;
    const ok = budget.take(urlsKey.split("|"));
    setAllowed(ok);
    if (!ok) onErrorRef.current?.();
  }, [urlsKey]);

  // No tiles (refused, budget): the sharp picture alone still carries the view.
  const showTiles = tiles.list.length > 0 && Boolean(allowed) && !tilesBroken;
  if (!showTiles && !detail) return null;
  return (
    <span className="pointer-events-none absolute inset-0 block overflow-hidden" aria-hidden="true">
      {showTiles && tiles.list.map((t) => (
        <img
          key={`${t.z}/${t.x}/${t.y}/${Math.round(t.left)}`}
          src={t.src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={onError}
          style={{ position: "absolute", left: t.left, top: t.top, width: tiles.tilePx, height: tiles.tilePx, maxWidth: "none" }}
        />
      ))}
      {detail && detailRect && (
        <img
          src={detail.objectUrl}
          alt=""
          decoding="async"
          draggable={false}
          className={detail.fade ? "animate-fade-in motion-reduce:animate-none" : undefined}
          style={{ position: "absolute", left: detailRect.left, top: detailRect.top, width: detailRect.width, height: detailRect.height, maxWidth: "none" }}
        />
      )}
    </span>
  );
}

/** SatelliteTiles sized to its parent box (for the course page's still
 * view, whose width depends on the screen). */
export function FittedSatelliteTiles(props: Omit<SatelliteTilesProps, "width" | "height">) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((s) => (s && Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span ref={ref} className="absolute inset-0 block">
      {size && <SatelliteTiles {...props} width={size.w} height={size.h} />}
    </span>
  );
}
