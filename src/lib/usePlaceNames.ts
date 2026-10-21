import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import { localizedAreaLabel } from "./placeNames";
import type { PlayingAreaPlace } from "./geo";
import { geoapifyRawPlaceId, sanitizePlaceNamesDto } from "../../supabase/functions/_shared/cityGeocode.ts";
import type { PlaceNamesDto } from "../../supabase/functions/_shared/cityGeocode.ts";

// Session cache of public.geo_places rows (localized city names), shared by
// every label on screen. Reads are batched into one select per tick and are
// free (no Geoapify credits). Only ensurePlaceNames(), called when the golfer
// themselves picks a geocoded city, can spend credits (course-search mode
// "place", 2 credits per new city, at most once per city ever thanks to the
// shared table). Viewers never trigger provider calls for other people's
// cities: a missing row just means the English area_label is shown.
//
// Before the migration the table doesn't exist: the first failed read turns
// the store off for the session, and every label falls back to area_label.

type Entry = PlaceNamesDto | null; // null = looked up, no row
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let pending = new Set<string>();
let flushScheduled = false;
let disabled = false;
let version = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function flush() {
  flushScheduled = false;
  const ids = Array.from(pending);
  pending = new Set();
  if (disabled || ids.length === 0) return;
  const { data, error } = await supabase.from("geo_places").select("place_id, names, country_code, region_code").in("place_id", ids);
  if (error) {
    disabled = true;
    return;
  }
  for (const id of ids) cache.set(id, null);
  for (const row of data ?? []) {
    const dto = sanitizePlaceNamesDto(row);
    if (dto) cache.set(dto.placeId, dto);
  }
  notify();
}

function requestRow(placeId: string) {
  if (disabled || cache.has(placeId) || !geoapifyRawPlaceId(placeId)) return;
  pending.add(placeId);
  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(() => void flush(), 0);
  }
}

export function getCachedPlaceNames(placeId: string): Entry | undefined {
  return cache.get(placeId);
}

/**
 * Names for a city the golfer just picked: the shared row if it exists,
 * otherwise one course-search "place" call that fills it. Resolves null on
 * any failure or after `timeoutMs`; callers then keep the searched label.
 */
export async function ensurePlaceNames(placeId: string, timeoutMs = 2500): Promise<PlaceNamesDto | null> {
  if (!geoapifyRawPlaceId(placeId)) return null;
  const known = cache.get(placeId);
  if (known) return known;
  const work = (async () => {
    if (!disabled) {
      const { data, error } = await supabase.from("geo_places").select("place_id, names, country_code, region_code").eq("place_id", placeId).maybeSingle();
      if (error) return null; // no table yet: don't spend credits on names we can't store
      const row = sanitizePlaceNamesDto(data);
      if (row) return row;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
    const { data, error } = await supabase.functions.invoke("course-search", { body: { mode: "place", placeId } });
    if (error) return null;
    return sanitizePlaceNamesDto((data as { place?: unknown } | null)?.place);
  })().catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const dto = await Promise.race([work, timeout]);
  if (dto) {
    cache.set(placeId, dto);
    notify();
  }
  return dto;
}

/** Playing-area label in the current viewer's app language. */
export function useLocalizedAreaLabel(areaLabel: string, place: PlayingAreaPlace | undefined): string {
  const { locale } = useLocale();
  const { isDemo } = useAuth();
  const placeId = place?.id;
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!isDemo && placeId) requestRow(placeId);
  }, [isDemo, placeId]);
  const lookup = useCallback((id: string) => (isDemo ? undefined : cache.get(id)), [isDemo]);
  return localizedAreaLabel({ areaLabel, place }, locale, lookup);
}
