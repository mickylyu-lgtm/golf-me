import Foundation
import UIKit
import Capacitor
import PhotosUI
import UniformTypeIdentifiers
import AVFoundation

// One-tap photo/video picker, exposed to the web app as the
// "GolfMeMediaPicker" Capacitor plugin (web side: src/lib/mediaPicker.ts).
//
// Why not <input type="file">: in WKWebView that opens the photo picker and
// then a "1 Selected" / "Location Included" sheet that needs another tap.
// Why not @capacitor/camera: its current chooseFromGallery (8.x, via
// IONCameraLib) is a custom grid with a Done button that asks for full photo
// library access first, and its PHPicker-based getPhoto/pickImages are
// deprecated and also ask for library access before showing the picker.
//
// This is the system PHPickerViewController with a single selection: tapping
// an item picks it and closes the picker. Created without a PHPhotoLibrary,
// so it needs no permission and no Info.plist usage string: the picker runs
// outside the app and only hands over the item that was tapped.
//
// Photos (unchanged since 2.4): pixels only. The photo is drawn into a new
// sRGB image (long edge at most 2048 px, white behind any transparency) and
// encoded as JPEG, so no EXIF/GPS leaves this file, and the bridge carries
// ~1 MB, not a 12 MP original. The web side still re-encodes it on a canvas
// (processChatImage), exactly like a file input photo.
//
// Videos (2.5): the most compatible version (preferredAssetRepresentationMode
// .compatible, so HEVC/HDR originals arrive as H.264; iOS exports it after
// the picker closes, which can take a moment), copied into
// Caches/GolfMeMediaPicks before
// loadFileRepresentation's callback returns (iOS deletes its own copy after
// that). No base64 in the pick result: a clip can be 200 MB. The page reads
// the copy back with readChunk (base64, at most 4 MB per call) and then
// calls discard. Why not fetch(webPath): the page is https://golfme.app
// (server.url) and webPath is capacitor://localhost/_capacitor_file_/...,
// another origin, and Capacitor's scheme handler answers .mov/.mp4 without
// the CORS header unless the request has a Range. The folder is emptied at
// the start of every video pick, so at most one picked video stays on disk
// even if discard never comes.
//
// pick({ kinds, limit }) with kinds ["image"], ["video"] or
// ["image", "video"] and limit 1...10 (default 1: one tap picks and closes;
// above 1 iOS shows its own Add button, selection numbered in tap order)
// resolves { items: [item, ...] } in the order the items were selected,
// each item { kind: "image", mimeType, base64 },
// { kind: "video", path, webPath, mimeType, size, name?, durationMs? } or
// { kind: "unreadable" }. With exactly one item, its fields are also at the
// top level (the 2.4 result shape). A cancel resolves { cancelled: true }.
// Rejects with "unsupported", "in_progress", "unavailable", or "unreadable"
// when the only picked item can't be read. Items load one after another,
// so ten 12 MP photos are never decoded at the same time.
// readChunk({ path, offset, length }) resolves { base64, bytesRead } (empty
// at the end); discard({ path }) deletes the copy. Both only accept a path
// inside the picker's own folder.
//
// The web side tells builds apart by this plugin's exported methods: 2.4 (1)
// has only pick (photos), so for video it keeps using the file input.
//
// Registered by GolfMeBridgeViewController (AppleSignInPlugin.swift).
@objc(GolfMeMediaPickerPlugin)
public class GolfMeMediaPickerPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "GolfMeMediaPickerPlugin"
    public let jsName = "GolfMeMediaPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise)
    ]

    // Same as the web side's first encode step (lib/chatImages.ts
    // ENCODE_LADDER), so this never costs the final photo any resolution.
    static let maxEdge: CGFloat = 2048
    static let jpegQuality: CGFloat = 0.92
    static let pickFolderName = "GolfMeMediaPicks"
    static let pickFilePrefix = "pick-"
    static let maxChunkLength = 4 * 1024 * 1024
    static let maxSelection = 10

    // Main thread only.
    private var pendingCall: CAPPluginCall?
    private var pendingKinds: [String] = []
    // Weak: the presenter holds it while it's up, so nil means it's gone.
    private weak var presentedPicker: PHPickerViewController?

    @objc func pick(_ call: CAPPluginCall) {
        let kinds = call.getArray("kinds", String.self) ?? ["image"]
        let wantsImage = kinds.contains("image")
        let wantsVideo = kinds.contains("video")
        guard !kinds.isEmpty, kinds.allSatisfy({ $0 == "image" || $0 == "video" }) else {
            call.reject("Only photos and videos can be picked.", "unsupported")
            return
        }
        let limit = max(1, min(call.getInt("limit") ?? 1, Self.maxSelection))

        DispatchQueue.main.async {
            if let stale = self.pendingCall {
                if self.presentedPicker != nil {
                    call.reject("The photo picker is already open.", "in_progress")
                    return
                }
                // The picker went away without a delegate callback: settle
                // the old call so it can't block this one.
                self.pendingCall = nil
                stale.resolve(["cancelled": true])
            }
            guard var presenter = self.bridge?.viewController else {
                call.reject("The photo picker can't be shown right now.", "unavailable")
                return
            }
            while let next = presenter.presentedViewController {
                presenter = next
            }

            var configuration = PHPickerConfiguration()
            configuration.selectionLimit = limit
            if limit > 1 {
                // Numbered in tap order; results come back in that order.
                configuration.selection = .ordered
            }
            if wantsImage && wantsVideo {
                configuration.filter = .any(of: [.images, .videos])
            } else if wantsVideo {
                configuration.filter = .videos
            } else {
                configuration.filter = .images
            }
            // Photos: as in 2.4, HEIC and other formats arrive as something
            // UIImage can always decode. Videos: iOS exports HEVC/HDR
            // originals as H.264, which every browser plays (HEVC Community
            // videos showed a black screen on some phones). Still one tap;
            // the export runs after the picker closes.
            configuration.preferredAssetRepresentationMode = .compatible

            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            self.pendingCall = call
            self.pendingKinds = kinds
            self.presentedPicker = picker
            presenter.present(picker, animated: true)
        }
    }

    @objc func readChunk(_ call: CAPPluginCall) {
        guard let url = Self.pickedFileURL(call.getString("path")) else {
            call.reject("Unknown file.", "invalid_argument")
            return
        }
        let offset = call.getInt("offset") ?? 0
        let length = min(call.getInt("length") ?? Self.maxChunkLength, Self.maxChunkLength)
        guard offset >= 0, length > 0 else {
            call.reject("Bad offset or length.", "invalid_argument")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                let data = try handle.read(upToCount: length) ?? Data()
                call.resolve([
                    "base64": data.base64EncodedString(),
                    "bytesRead": data.count
                ])
            } catch {
                call.reject("That video can't be read.", "unreadable")
            }
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        guard let url = Self.pickedFileURL(call.getString("path")) else {
            call.reject("Unknown file.", "invalid_argument")
            return
        }
        try? FileManager.default.removeItem(at: url)
        call.resolve()
    }

    // MARK: - PHPickerViewControllerDelegate

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        presentedPicker = nil
        guard let call = pendingCall else { return }
        pendingCall = nil
        let kinds = pendingKinds
        pendingKinds = []

        // No result: the user cancelled.
        let providers = results.map { $0.itemProvider }
        if providers.isEmpty {
            call.resolve(["cancelled": true])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            // Only this pick's videos stay on disk.
            let folder = kinds.contains("video") ? GolfMeMediaPickerPlugin.pickFolder(clearing: true) : nil
            self.loadItems(providers, kinds, folder, 0, [], call)
        }
    }

    // Loads providers[index...] one at a time (in selection order), then
    // resolves the call with every item.
    private func loadItems(
        _ providers: [NSItemProvider],
        _ kinds: [String],
        _ folder: URL?,
        _ index: Int,
        _ items: [[String: Any]],
        _ call: CAPPluginCall
    ) {
        guard index < providers.count else {
            finish(items, call)
            return
        }
        loadItem(providers[index], kinds, folder) { item in
            let next: [String: Any] = item ?? ["kind": "unreadable"]
            self.loadItems(providers, kinds, folder, index + 1, items + [next], call)
        }
    }

    private func finish(_ items: [[String: Any]], _ call: CAPPluginCall) {
        guard items.count == 1, let only = items.first else {
            call.resolve(["items": items])
            return
        }
        if only["kind"] as? String == "unreadable" {
            call.reject("That item can't be read.", "unreadable")
            return
        }
        // One item: also at the top level, as 2.4 returned it.
        var result = only
        result["items"] = items
        call.resolve(result)
    }

    private func loadItem(
        _ provider: NSItemProvider,
        _ kinds: [String],
        _ folder: URL?,
        _ completion: @escaping ([String: Any]?) -> Void
    ) {
        // A video can't load as a UIImage, so a photo is checked first.
        if kinds.contains("image") && provider.canLoadObject(ofClass: UIImage.self) {
            loadImage(provider, completion)
        } else if kinds.contains("video"), let folder = folder,
                  provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            loadVideo(provider, folder, completion)
        } else {
            completion(nil)
        }
    }

    private func loadImage(_ provider: NSItemProvider, _ completion: @escaping ([String: Any]?) -> Void) {
        // Called on a background queue; the encode stays there.
        _ = provider.loadObject(ofClass: UIImage.self) { object, _ in
            guard let image = object as? UIImage,
                  let jpeg = GolfMeMediaPickerPlugin.jpegData(for: image) else {
                completion(nil)
                return
            }
            completion([
                "kind": "image",
                "mimeType": "image/jpeg",
                "base64": jpeg.base64EncodedString()
            ])
        }
    }

    private func loadVideo(_ provider: NSItemProvider, _ folder: URL, _ completion: @escaping ([String: Any]?) -> Void) {
        let suggestedName = provider.suggestedName
        // Called on a background queue. The file at `url` is deleted when this
        // returns, so it's copied before that.
        _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] url, _ in
            guard let source = url else {
                completion(nil)
                return
            }
            let ext = source.pathExtension.isEmpty ? "mov" : source.pathExtension.lowercased()
            let destination = folder.appendingPathComponent("\(GolfMeMediaPickerPlugin.pickFilePrefix)\(UUID().uuidString).\(ext)")
            do {
                try FileManager.default.copyItem(at: source, to: destination)
            } catch {
                completion(nil)
                return
            }
            let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            let mimeType = UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/quicktime"
            var result: [String: Any] = [
                "kind": "video",
                "path": destination.path,
                "mimeType": mimeType,
                "size": size
            ]
            if let webPath = self?.bridge?.portablePath(fromLocalURL: destination)?.absoluteString {
                result["webPath"] = webPath
            }
            if let name = suggestedName, !name.isEmpty {
                result["name"] = name
            }
            // A local file: reading its duration is quick.
            let seconds = CMTimeGetSeconds(AVURLAsset(url: destination).duration)
            if seconds.isFinite && seconds > 0 {
                result["durationMs"] = Int((seconds * 1000).rounded())
            }
            completion(result)
        }
    }

    // MARK: - Picked-file folder

    // Caches/GolfMeMediaPicks, created if missing; with clearing, emptied
    // first (only the newest pick is ever kept).
    static func pickFolder(clearing: Bool) -> URL? {
        let fileManager = FileManager.default
        guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let folder = caches.appendingPathComponent(pickFolderName, isDirectory: true)
        if clearing, let old = try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
            for file in old {
                try? fileManager.removeItem(at: file)
            }
        }
        do {
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        return folder
    }

    // The file for a path the web side passed back, only if it's one of this
    // plugin's own copies (no other app file can be read through readChunk).
    static func pickedFileURL(_ path: String?) -> URL? {
        guard let path = path, !path.isEmpty, let folder = pickFolder(clearing: false) else { return nil }
        let name = (path as NSString).lastPathComponent
        guard name.hasPrefix(pickFilePrefix), !name.contains("/") else { return nil }
        let url = folder.appendingPathComponent(name)
        guard url.standardizedFileURL.path == URL(fileURLWithPath: path).standardizedFileURL.path else { return nil }
        return url
    }

    // Draws the photo upright (UIImage applies its orientation when drawn)
    // into a fresh 8-bit sRGB bitmap: only pixels, no metadata.
    static func jpegData(for image: UIImage) -> Data? {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        guard pixelWidth > 0, pixelHeight > 0 else { return nil }
        let scale = min(1, maxEdge / max(pixelWidth, pixelHeight))
        let target = CGSize(
            width: max(1, (pixelWidth * scale).rounded()),
            height: max(1, (pixelHeight * scale).rounded())
        )

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        let rendered = renderer.image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return rendered.jpegData(compressionQuality: jpegQuality)
    }
}
