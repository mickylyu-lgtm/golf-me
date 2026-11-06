// The chat composer's photo button: the shared picker (lib/mediaPicker.ts).
// Native PHPicker in builds with the GolfMeMediaPicker plugin, else the
// composer's hidden <input type="file">. Either way the photo goes on as a
// File to onPickImage, i.e. through processChatImage
// (lib/chatImageClient.ts): decoded and re-encoded on a canvas, so EXIF/GPS
// never reach an upload.
//
// Several photos/videos at once (chat albums): pickChatMediaFiles with
// kinds ["image", "video"] and a limit (up to 10). 2.5+ builds pick them
// natively in selection order; 2.4 and the web open the file input, which
// should then have `multiple`.

export {
  pickMedia as pickChatMedia,
  pickMediaFiles as pickChatMediaFiles,
  fileFromNativeResult,
  unreadablePickFile,
} from "./mediaPicker";
export type {
  MediaKind as ChatMediaKind,
  MediaPickerDriver as ChatMediaPickerDriver,
  NativePickResult,
  PickMediaOptions as PickChatMediaOptions,
  PickMediaFilesOptions as PickChatMediaFilesOptions,
  PickOutcome,
} from "./mediaPicker";
