import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "./supabase";
import { lookupCoursePhoto } from "./coursePhotos";
import {
  MAX_COURSE_IDS_PER_REQUEST,
  type CourseBounds,
  type CoursePhotoOut,
  type CoursePhotoSize,
  type CoursePhotosResponse,
  type PhotoAuthor,
} from "../../supabase/functions/_shared/coursePhotoTypes.ts";

// The best real photo of a course, and its outline, for any list row, map
// card or course page (Micky, 2026-11-05: what the actual course looks
// like).
//
// Real courses (with a public.courses id, real accounts): the course-photos
// Edge Function, which tries Google Places then Wikimedia server-side and
// knows the course's OpenStreetMap outline (so satellite views frame the
// holes, not the clubhouse pin). Thumbnails that mount together (a list)
// are batched into one call; each answer is kept in memory for this app
// session only (Google photo URLs are short-lived and must not be cached),
// so scrolling or coming back to a list never asks again. Satellite-only
// views ask for the outline alone, so they never trigger a photo call.
// Demo courses (no id), or a project where course-photos isn't deployed
// yet: the old browser-side Wikimedia lookup, and the fixture's outline.

export interface CoursePhoto {
  source: "google" | "wikimedia";
  url: string;
  /** Wikimedia: "Author, LICENSE / Wikimedia Commons". */
  credit?: string;
  /** Wikimedia: the file's Commons page. */
  pageUrl?: string;
  license?: string | null;
  /** Google: photo authors (must be shown with the full-size photo). */
  authors?: PhotoAuthor[];
  /** Google: the photo / place on Google Maps. */
  mapsUri?: string;
}

export interface CoursePhotoState {
  photo: CoursePhoto | null;
  /** False while still looking (keep the box, don't flash a fallback). */
  settled: boolean;
  /** The course's outline, when known (null: none / not known yet). */
  bounds: CourseBounds | null;
}

interface CourseLike {
  id?: string;
  name: string;
  lat?: number;
  lng?: number;
  bounds?: CourseBounds | null;
}

type Kind = CoursePhotoSize | "outline";
type Answer = { kind: "photo"; photo: CoursePhoto | null } | { kind: "unresolved" } | { kind: "unavailable" };

const BATCH_DELAY_MS = 30;
// A course the server couldn't resolve (cap reached, provider down) isn't
// asked again for this long in this session.
const UNRESOLVED_RETRY_MS = 10 * 60 * 1000;

const answers = new Map<string, { answer: Answer; at: number }>();
const outlines = new Map<string, CourseBounds | null>();
const waiting = new Map<string, ((a: Answer) => void)[]>();
const queued: Record<Kind, Set<string>> = { thumb: new Set(), hero: new Set(), outline: new Set() };
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Set when the function itself is missing/broken: the rest of this session
// uses the browser fallback instead of failing every row.
let functionUnavailable = false;

const keyOf = (kind: Kind, id: string) => `${kind}:${id}`;

function settle(kind: Kind, id: string, answer: Answer) {
  const key = keyOf(kind, id);
  if (answer.kind !== "unavailable") answers.set(key, { answer, at: Date.now() });
  const fns = waiting.get(key) ?? [];
  waiting.delete(key);
  fns.forEach((fn) => fn(answer));
}

// Has a Google photo been served this session? Lists name "Google Maps" in
// their credit line only then (Wikimedia-only setups never show it).
let googleShown = false;
const googleListeners = new Set<() => void>();

export function useGooglePhotosShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      googleListeners.add(l);
      return () => googleListeners.delete(l);
    },
    () => googleShown,
  );
}

function toPhoto(out: CoursePhotoOut): CoursePhoto {
  if (out.source === "google" && !googleShown) {
    googleShown = true;
    googleListeners.forEach((l) => l());
  }
  return out.source === "google"
    ? { source: "google", url: out.url, authors: out.authors, mapsUri: out.mapsUri }
    : { source: "wikimedia", url: out.url, credit: out.credit, pageUrl: out.pageUrl, license: out.license };
}

async function flush() {
  flushTimer = null;
  for (const kind of ["thumb", "hero", "outline"] as const) {
    const ids = [...queued[kind]];
    queued[kind].clear();
    for (let i = 0; i < ids.length; i += MAX_COURSE_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_COURSE_IDS_PER_REQUEST);
      if (functionUnavailable) {
        chunk.forEach((id) => settle(kind, id, { kind: "unavailable" }));
        continue;
      }
      try {
        const body = kind === "outline" ? { courseIds: chunk, outlineOnly: true } : { courseIds: chunk, size: kind };
        const { data, error } = await supabase.functions.invoke("course-photos", { body });
        if (error) throw error;
        const res = data as CoursePhotosResponse | null;
        if (!res?.photos || typeof res.photos !== "object") throw new Error("bad response");
        for (const [id, b] of Object.entries(res.bounds ?? {})) outlines.set(id, b);
        for (const id of chunk) {
          if (kind === "outline") settle(kind, id, { kind: "photo", photo: null });
          else settle(kind, id, id in res.photos ? { kind: "photo", photo: res.photos[id] ? toPhoto(res.photos[id]!) : null } : { kind: "unresolved" });
        }
      } catch (err) {
        // 404 (not deployed), 5xx, network: browser fallback for now.
        functionUnavailable = true;
        console.warn("GolfMe: course-photos unavailable, using the browser lookup.", err);
        chunk.forEach((id) => settle(kind, id, { kind: "unavailable" }));
      }
    }
  }
}

function askServer(id: string, kind: Kind): Promise<Answer> {
  const key = keyOf(kind, id);
  const known = answers.get(key);
  if (known && (known.answer.kind === "photo" || Date.now() - known.at < UNRESOLVED_RETRY_MS)) return Promise.resolve(known.answer);
  // An outline already came back with a photo answer: nothing to ask.
  if (kind === "outline" && outlines.has(id)) return Promise.resolve({ kind: "photo", photo: null });
  if (functionUnavailable) return Promise.resolve({ kind: "unavailable" });
  return new Promise((resolve) => {
    const list = waiting.get(key);
    if (list) {
      list.push(resolve);
      return;
    }
    waiting.set(key, [resolve]);
    queued[kind].add(id);
    flushTimer ??= setTimeout(() => void flush(), BATCH_DELAY_MS);
  });
}

async function browserLookup(course: CourseLike, size: CoursePhotoSize): Promise<CoursePhoto | null> {
  if (course.lat == null || course.lng == null) return null;
  const p = await lookupCoursePhoto(course.name, course.lat, course.lng);
  if (!p) return null;
  return { source: "wikimedia", url: size === "thumb" ? p.thumbUrl : p.url, credit: p.credit, pageUrl: p.pageUrl };
}

export async function loadCoursePhoto(course: CourseLike, size: CoursePhotoSize, useServer: boolean): Promise<CoursePhoto | null> {
  if (useServer && course.id) {
    const answer = await askServer(course.id, size);
    if (answer.kind === "photo") return answer.photo;
    if (answer.kind === "unresolved") return null;
  }
  return browserLookup(course, size);
}

/** The course's photo (when `wantPhoto`) and outline. With `wantPhoto`
 * false only the outline is fetched (no photo lookup, nothing billable). */
export function useBestCoursePhoto(course: CourseLike | null | undefined, size: CoursePhotoSize, wantPhoto = true): CoursePhotoState {
  const { isDemo } = useAuth();
  const id = course?.id;
  const name = course?.name;
  const lat = course?.lat;
  const lng = course?.lng;
  const given = course?.bounds ?? null;
  const useServer = !isDemo && Boolean(id);
  const [state, setState] = useState<CoursePhotoState>({ photo: null, settled: false, bounds: given ?? (id ? (outlines.get(id) ?? null) : null) });

  useEffect(() => {
    const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
    const outlineNow = () => given ?? (id ? (outlines.get(id) ?? null) : null);
    if (!name || (!id && !hasCoords)) {
      setState({ photo: null, settled: true, bounds: outlineNow() });
      return;
    }
    let cancelled = false;
    if (!wantPhoto) {
      setState({ photo: null, settled: true, bounds: outlineNow() });
      if (useServer && !given) void askServer(id!, "outline").then(() => !cancelled && setState({ photo: null, settled: true, bounds: outlineNow() }));
      return () => {
        cancelled = true;
      };
    }
    setState({ photo: null, settled: false, bounds: outlineNow() });
    void loadCoursePhoto({ id, name, lat, lng }, size, useServer)
      .catch(() => null)
      .then((photo) => !cancelled && setState({ photo, settled: true, bounds: outlineNow() }));
    return () => {
      cancelled = true;
    };
  }, [id, name, lat, lng, size, wantPhoto, useServer, given]);

  return state;
}
