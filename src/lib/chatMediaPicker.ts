import { Capacitor, registerPlugin } from "@capacitor/core";

// What the chat composer's photo button does.
//
// Native iOS app (a build that has the GolfMeMediaPicker plugin,
// ios/App/App/MediaPickerPlugin.swift): the system photo picker
// (PHPickerViewController) with a single selection, so tapping a photo picks
// it and closes the picker. No "1 Photo Selected · Location Included" step
// (that's WKWebView's own sheet for <input type="file">), and no photo
// library permission prompt: PHPicker runs outside the app and only hands
// over the photo that was tapped.
//
// Web / PWA, and native builds without the plugin (2.3 and older load the
// same live site): the composer's hidden <input type="file" accept="image/*">,
// exactly as before. The choice is made synchronously inside the tap, before
// any await, because browsers only open a file input from a user gesture.
//
// Either way the photo goes on as a File to onPickImage, i.e. through
// processChatImage (lib/chatImageClient.ts): decoded and re-encoded on a
// canvas, so EXIF/GPS never reach an upload. The native side already sends
// pixels only (a UIImage re-encoded as JPEG, long edge <= 2048, which is the
// canvas's own first step), so the bridge never carries a 12 MP original.
//
// Video (chat video upload, later): `kinds` is passed to the plugin as is;
// this build's plugin accepts ["image"] only. A video won't come back as
// base64 (far too big for the bridge): it will need a file path in the
// result, read as a Blob on the web side, when it's built.

export type ChatMediaKind = "image" | "video";

/** What the native plugin resolves with. A cancel resolves, it never rejects. */
export interface NativePickResult {
  cancelled?: boolean;
  kind?: ChatMediaKind;
  mimeType?: string;
  /** The picked image's bytes, base64 (no data: prefix). */
  base64?: string;
}

export interface ChatMediaPickerDriver {
  /** Whether this tap should use the native picker (else the file input). */
  nativeAvailable(): boolean;
  pickNative(kinds: readonly ChatMediaKind[]): Promise<NativePickResult>;
}

export interface PickChatMediaOptions {
  kinds?: readonly ChatMediaKind[];
  /** Opens the composer's hidden file input (web path). */
  openFileInput: () => void;
  onPicked: (file: File) => void;
}

export type PickOutcome = "web" | "native" | "cancelled" | "failed" | "busy";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The native result as a File for the existing pipeline, or null if it isn't a usable image. */
export function fileFromNativeResult(result: NativePickResult): File | null {
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

/**
 * A picked-but-unusable photo, handed on like any other so the page shows its
 * usual "couldn't read that photo" toast (processChatImage can't decode an
 * empty file). Keeps the error message in one place, with the pages.
 */
export function unreadablePickFile(): File {
  return new File([], "photo.jpg", { type: "image/jpeg" });
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function createChatMediaPicker(driver: ChatMediaPickerDriver) {
  let busy = false;
  return async function pickChatMedia({ kinds = ["image"], openFileInput, onPicked }: PickChatMediaOptions): Promise<PickOutcome> {
    let native = false;
    try {
      native = driver.nativeAvailable();
    } catch {
      native = false;
    }
    if (!native) {
      // Synchronous, still inside the tap.
      openFileInput();
      return "web";
    }
    // A second tap while the picker is opening: ignore it.
    if (busy) return "busy";
    busy = true;
    try {
      const result = await driver.pickNative(kinds);
      if (!result || result.cancelled) return "cancelled";
      const file = fileFromNativeResult(result);
      onPicked(file ?? unreadablePickFile());
      return file ? "native" : "failed";
    } catch (err) {
      if (errorCode(err) === "in_progress") return "busy";
      onPicked(unreadablePickFile());
      return "failed";
    } finally {
      busy = false;
    }
  };
}

const PLUGIN = "GolfMeMediaPicker";

interface GolfMeMediaPickerPlugin {
  pick(options: { kinds: ChatMediaKind[] }): Promise<NativePickResult>;
}

const NativeMediaPicker = registerPlugin<GolfMeMediaPickerPlugin>(PLUGIN);

export const capacitorMediaPickerDriver: ChatMediaPickerDriver = {
  nativeAvailable: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable(PLUGIN),
  pickNative: (kinds) => NativeMediaPicker.pick({ kinds: [...kinds] }),
};

/** The app's one picker (the composer's photo button). */
export const pickChatMedia = createChatMediaPicker(capacitorMediaPickerDriver);
