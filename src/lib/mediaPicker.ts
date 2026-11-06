import { Capacitor, registerPlugin } from "@capacitor/core";

// The app's one photo/video picker: the chat photo button
// (lib/chatMediaPicker.ts), Caddie's video upload (pages/AnalyzeSwing.tsx),
// the Swing Post video and the post's photos/videos (pages/CreatePost.tsx).
//
// Native iOS app with the GolfMeMediaPicker plugin
// (ios/App/App/MediaPickerPlugin.swift): the system PHPickerViewController.
// With limit 1, one tap picks and closes: no "1 Selected" / "Location
// Included" step (that's WKWebView's own sheet for <input type="file">).
// With limit > 1, iOS numbers the selection in tap order and shows its own
// Add button; files come back in that order. No photo library permission
// prompt either way.
//
// Web / PWA, and builds whose plugin can't do the request: the page's hidden
// <input type="file"> (with `multiple` when the page wants several), exactly
// as before. That choice is made synchronously inside the tap, before any
// await, because a file input only opens from a user gesture. So "what can
// this build pick" can't be an async plugin call either; it's read from the
// plugin's method list, which the native side puts on
// window.Capacitor.PluginHeaders before the page runs: build 2.4 (1) exports
// only `pick` (one photo), 2.5+ also exports `readChunk` and `discard`
// (photos and videos, up to 10 at once).
//
// Photos come back as base64 (pixels-only JPEG, ~1 MB each), as in 2.4.
// Videos are too big for one bridge message, and the page (https://golfme.app,
// capacitor.config.ts server.url) can't reliably fetch the native file
// through its capacitor://localhost/_capacitor_file_ URL: it's another
// origin, and Capacitor's scheme handler answers .mov/.mp4 without the CORS
// header outside a Range request. So the plugin copies each picked video into
// the app's caches folder and the page reads it back over the bridge in
// 2 MB chunks (readChunk, base64), builds a File, and asks the plugin to
// delete its copy (discard).
//
// Either way the result is a File (or File[]) handed to the page's existing
// handler, i.e. exactly what its file input would have produced.

export type MediaKind = "image" | "video";

/** One picked item from the native plugin. */
export interface NativePickItem {
  kind?: MediaKind | "unreadable";
  mimeType?: string;
  /** Image only: the bytes, base64 (no data: prefix). */
  base64?: string;
  /** Video only: the app-local copy, for readChunk/discard. */
  path?: string;
  /** Video only: the capacitor:// URL of the same file (not used: see above). */
  webPath?: string;
  /** Video only: the original's name, when Photos gives one. */
  name?: string;
  /** Video only: byte size of the copy. */
  size?: number;
  durationMs?: number;
}

/**
 * What the native plugin's pick resolves with. A cancel resolves, it never
 * rejects. 2.5+ returns `items` in selection order (and, for one item, the
 * same fields at the top level); 2.4 returns one image at the top level.
 */
export interface NativePickResult extends NativePickItem {
  cancelled?: boolean;
  items?: NativePickItem[];
}

export interface NativeChunk {
  /** Base64 of the bytes read (empty at the end of the file). */
  base64: string;
  bytesRead?: number;
}

export interface NativeCapabilities {
  /** Kinds the native picker can do in this build ([] on the web). */
  kinds: readonly MediaKind[];
  /** Whether it can pick more than one item at once. */
  multiple: boolean;
}

export interface MediaPickerDriver {
  /** What this build's native picker can do. Synchronous: it runs inside the tap. */
  capabilities(): NativeCapabilities;
  pickNative(kinds: readonly MediaKind[], limit: number): Promise<NativePickResult>;
  readChunk(path: string, offset: number, length: number): Promise<NativeChunk>;
  discard(path: string): Promise<void>;
}

interface CommonPickOptions {
  kinds?: readonly MediaKind[];
  /** Opens the page's hidden file input (web path). */
  openFileInput: () => void;
  /** Native video: true while picked videos are read into the page (big clips take a moment), then false. */
  onLoading?: (loading: boolean) => void;
  /** Native video: a bigger one isn't read at all and onTooLarge runs (once per pick). */
  maxVideoBytes?: number;
  onTooLarge?: () => void;
}

export interface PickMediaOptions extends CommonPickOptions {
  onPicked: (file: File) => void;
}

export interface PickMediaFilesOptions extends CommonPickOptions {
  /** Most items at once (native: 1...10; the web input should have `multiple` when this is above 1). */
  limit: number;
  /** In selection order. An empty File stands for one that couldn't be read (see unreadablePickFile). */
  onPicked: (files: File[]) => void;
}

export type PickOutcome = "web" | "native" | "cancelled" | "failed" | "busy" | "too_large";

/** Raw bytes per readChunk call (base64 on the bridge is a third bigger). */
export const VIDEO_CHUNK_BYTES = 2 * 1024 * 1024;
/** The native picker's most items at once. */
export const MAX_NATIVE_SELECTION = 10;

// Files this module built in memory from a native pick. AnalyzeSwing and
// CreatePost copy a picked video into memory because WebKit can drop the
// bytes behind a disk-backed input File; these already are an in-memory
// copy, so a second copy of up to 200 MB is skipped (isInMemoryPick).
const inMemoryPicks = new WeakSet<File>();

/** Whether this File is already an in-memory copy (a native video pick). */
export function isInMemoryPick(file: File): boolean {
  return inMemoryPicks.has(file);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A native image item as a File for the existing pipeline, or null if it isn't a usable image. */
export function fileFromNativeResult(result: NativePickItem): File | null {
  if (result.kind !== "image") return null;
  const type = typeof result.mimeType === "string" && result.mimeType.startsWith("image/") ? result.mimeType : null;
  if (!type || typeof result.base64 !== "string" || result.base64.length === 0) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(result.base64);
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const ext = type === "image/png" ? "png" : "jpg";
  return new File([bytes], `photo.${ext}`, { type });
}

const VIDEO_TYPES: Record<string, string> = { mov: "video/quicktime", qt: "video/quicktime", mp4: "video/mp4", m4v: "video/mp4" };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/** Type and file name for a native video item, or null if it isn't a video. */
export function videoFileInfo(result: NativePickItem): { type: string; name: string } | null {
  if (result.kind !== "video" || typeof result.path !== "string" || result.path.length === 0) return null;
  const ext = extensionOf(result.path) || "mov";
  const type =
    typeof result.mimeType === "string" && /^video\/[a-z0-9.+-]+$/i.test(result.mimeType) ? result.mimeType : VIDEO_TYPES[ext];
  if (!type) return null;
  // Photos' own name ("IMG_1234") when it has one; the pages show it and
  // use its extension for the upload path.
  const rawName = typeof result.name === "string" ? result.name : "";
  const base = rawName
    .replace(/\.[^.]*$/, "")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .slice(0, 80);
  return { type, name: `${base || "video"}.${ext}` };
}

/**
 * Reads a picked native video into a File, chunk by chunk. Each chunk becomes
 * its own Blob right away, so the decoded bytes don't pile up next to the
 * finished File. Null if nothing usable came back (or the size doesn't match
 * what the plugin reported).
 */
export async function readNativeVideo(
  driver: Pick<MediaPickerDriver, "readChunk">,
  result: NativePickItem,
  chunkBytes = VIDEO_CHUNK_BYTES,
): Promise<File | null> {
  const info = videoFileInfo(result);
  if (!info) return null;
  const path = result.path as string;
  const expected = typeof result.size === "number" && Number.isFinite(result.size) && result.size > 0 ? result.size : undefined;
  const parts: Blob[] = [];
  let offset = 0;
  // A hard stop in case the plugin keeps answering (it never should).
  const maxReads = expected !== undefined ? Math.ceil(expected / chunkBytes) + 1 : 10_000;
  for (let reads = 0; reads < maxReads; reads++) {
    const chunk = await driver.readChunk(path, offset, chunkBytes);
    const bytes = typeof chunk?.base64 === "string" && chunk.base64.length > 0 ? base64ToBytes(chunk.base64) : new Uint8Array(0);
    if (bytes.length === 0) break;
    parts.push(new Blob([bytes]));
    offset += bytes.length;
    if (expected !== undefined && offset >= expected) break;
    if (bytes.length < chunkBytes) break;
  }
  if (offset === 0) return null;
  if (expected !== undefined && offset !== expected) return null;
  const file = new File(parts, info.name, { type: info.type });
  inMemoryPicks.add(file);
  return file;
}

/**
 * A picked-but-unusable file, handed on like any other so the page shows its
 * usual message: an empty JPEG for photos (processChatImage can't decode it,
 * "couldn't read that photo"), an empty untyped file for videos (the video
 * pages' "not a supported video" check). Keeps the copy with the pages.
 */
export function unreadablePickFile(kinds: readonly MediaKind[] = ["image"]): File {
  if (kinds.includes("image")) return new File([], "photo.jpg", { type: "image/jpeg" });
  return new File([], "video", { type: "application/octet-stream" });
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** The picked items in order: 2.5+ `items`, else the 2.4 single result. */
function itemsOf(result: NativePickResult): NativePickItem[] {
  if (Array.isArray(result.items)) return result.items.filter((i): i is NativePickItem => !!i && typeof i === "object");
  return [result];
}

export function createMediaPicker(driver: MediaPickerDriver) {
  // One picker for the whole app: a tap anywhere while one is open or a
  // video is still being read is ignored.
  let busy = false;

  async function pickMediaFiles({
    kinds = ["image"],
    limit,
    openFileInput,
    onPicked,
    onLoading,
    maxVideoBytes,
    onTooLarge,
  }: PickMediaFilesOptions): Promise<PickOutcome> {
    const max = Math.max(1, Math.min(Math.floor(Number.isFinite(limit) ? limit : 1), MAX_NATIVE_SELECTION));
    let native = false;
    try {
      const caps = driver.capabilities();
      native = kinds.length > 0 && kinds.every((k) => caps.kinds.includes(k)) && (max === 1 || caps.multiple);
    } catch {
      native = false;
    }
    if (!native) {
      // Synchronous, still inside the tap.
      openFileInput();
      return "web";
    }
    if (busy) return "busy";
    busy = true;
    const videoPaths: string[] = [];
    let loading = false;
    try {
      const result = await driver.pickNative(kinds, max);
      if (!result || result.cancelled) return "cancelled";
      const items = itemsOf(result).slice(0, max);
      for (const item of items) {
        if (item.kind === "video" && typeof item.path === "string" && item.path.length > 0) videoPaths.push(item.path);
      }
      if (items.length === 0) return "cancelled";

      const files: File[] = [];
      let tooLarge = 0;
      for (const item of items) {
        if (item.kind === "video") {
          if (maxVideoBytes !== undefined && typeof item.size === "number" && item.size > maxVideoBytes) {
            tooLarge++;
            continue;
          }
          if (!loading) {
            loading = true;
            onLoading?.(true);
          }
          let file: File | null = null;
          try {
            file = await readNativeVideo(driver, item);
          } catch {
            file = null;
          }
          files.push(file ?? unreadablePickFile(["video"]));
        } else if (item.kind === "image") {
          files.push(fileFromNativeResult(item) ?? unreadablePickFile(["image"]));
        } else {
          files.push(unreadablePickFile(kinds));
        }
      }
      if (tooLarge > 0) onTooLarge?.();
      if (files.length === 0) return "too_large";
      onPicked(files);
      return files.some((f) => f.size > 0) ? "native" : "failed";
    } catch (err) {
      if (errorCode(err) === "in_progress") return "busy";
      onPicked([unreadablePickFile(kinds)]);
      return "failed";
    } finally {
      if (loading) onLoading?.(false);
      for (const path of videoPaths) {
        // Best effort; the next video pick clears the folder anyway.
        driver.discard(path).catch(() => undefined);
      }
      busy = false;
    }
  }

  /** One item: one tap picks and closes (native), else the page's single file input. */
  function pickMedia({ onPicked, ...rest }: PickMediaOptions): Promise<PickOutcome> {
    return pickMediaFiles({
      ...rest,
      limit: 1,
      onPicked: (files) => {
        if (files[0]) onPicked(files[0]);
      },
    });
  }

  return { pickMedia, pickMediaFiles };
}

const PLUGIN = "GolfMeMediaPicker";

interface GolfMeMediaPickerPlugin {
  pick(options: { kinds: MediaKind[]; limit: number }): Promise<NativePickResult>;
  readChunk(options: { path: string; offset: number; length: number }): Promise<NativeChunk>;
  discard(options: { path: string }): Promise<void>;
}

const NativeMediaPicker = registerPlugin<GolfMeMediaPickerPlugin>(PLUGIN);

interface PluginHeader {
  name?: string;
  methods?: { name?: string }[];
}

/** What a plugin with these exported methods can do: 2.4 has pick only (one photo), 2.5+ adds readChunk (photos, videos, several at once). */
export function capabilitiesFromMethods(methods: readonly string[]): NativeCapabilities {
  if (!methods.includes("pick")) return { kinds: [], multiple: false };
  return methods.includes("readChunk") ? { kinds: ["image", "video"], multiple: true } : { kinds: ["image"], multiple: false };
}

export const capacitorMediaPickerDriver: MediaPickerDriver = {
  capabilities: () => {
    if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable(PLUGIN))) {
      return { kinds: [], multiple: false };
    }
    const headers = (Capacitor as unknown as { PluginHeaders?: PluginHeader[] }).PluginHeaders;
    const header = Array.isArray(headers) ? headers.find((h) => h?.name === PLUGIN) : undefined;
    const methods = (header?.methods ?? []).map((m) => m?.name).filter((n): n is string => typeof n === "string");
    // No header to read (shouldn't happen when the plugin is available):
    // one photo, as in 2.4.
    return methods.length > 0 ? capabilitiesFromMethods(methods) : { kinds: ["image"], multiple: false };
  },
  pickNative: (kinds, limit) => NativeMediaPicker.pick({ kinds: [...kinds], limit }),
  readChunk: (path, offset, length) => NativeMediaPicker.readChunk({ path, offset, length }),
  discard: (path) => NativeMediaPicker.discard({ path }),
};

const appPicker = createMediaPicker(capacitorMediaPickerDriver);

/** The app's one picker, one item (a File). */
export const pickMedia = appPicker.pickMedia;
/** The app's one picker, up to `limit` items in selection order (File[]). Shares pickMedia's busy guard. */
export const pickMediaFiles = appPicker.pickMediaFiles;
