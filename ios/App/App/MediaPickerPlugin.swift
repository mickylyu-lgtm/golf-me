import Foundation
import UIKit
import Capacitor
import PhotosUI

// One-tap photo picker for chat, exposed to the web app as the
// "GolfMeMediaPicker" Capacitor plugin (web side: src/lib/chatMediaPicker.ts).
//
// Why not <input type="file">: in WKWebView that opens the photo picker and
// then a "1 Photo Selected · Location Included" sheet that needs another tap.
// Why not @capacitor/camera: its current chooseFromGallery (8.x, via
// IONCameraLib) is a custom grid with a Done button that asks for full photo
// library access first, and its PHPicker-based getPhoto/pickImages are
// deprecated and also ask for library access before showing the picker.
//
// This is the system PHPickerViewController with a single selection: tapping
// a photo picks it and closes the picker. Created without a PHPhotoLibrary,
// so it needs no permission and no Info.plist usage string: the picker runs
// outside the app and only hands over the photo that was tapped.
//
// The result is pixels only: the photo is drawn into a new sRGB image (long
// edge at most 2048 px, white behind any transparency) and encoded as JPEG,
// so no EXIF/GPS leaves this file, and the bridge carries ~1 MB, not a 12 MP
// original. The web side still re-encodes it on a canvas
// (processChatImage), exactly like a file input photo.
//
// pick({ kinds }) resolves { kind: "image", mimeType, base64 } or
// { cancelled: true }; rejects with code "unsupported" (kinds other than
// ["image"]; video is for a later build and will return a file path, not
// base64), "in_progress", "unavailable" or "unreadable".
//
// Registered by GolfMeBridgeViewController (AppleSignInPlugin.swift), so the
// web code can tell a build that has it with
// Capacitor.isPluginAvailable("GolfMeMediaPicker"); older builds keep using
// the file input.
@objc(GolfMeMediaPickerPlugin)
public class GolfMeMediaPickerPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "GolfMeMediaPickerPlugin"
    public let jsName = "GolfMeMediaPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    // Same as the web side's first encode step (lib/chatImages.ts
    // ENCODE_LADDER), so this never costs the final photo any resolution.
    static let maxEdge: CGFloat = 2048
    static let jpegQuality: CGFloat = 0.92

    // Main thread only.
    private var pendingCall: CAPPluginCall?
    // Weak: the presenter holds it while it's up, so nil means it's gone.
    private weak var presentedPicker: PHPickerViewController?

    @objc func pick(_ call: CAPPluginCall) {
        let kinds = call.getArray("kinds", String.self) ?? ["image"]
        guard kinds == ["image"] else {
            call.reject("Only photos can be picked in this version of the app.", "unsupported")
            return
        }

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
            configuration.selectionLimit = 1
            configuration.filter = .images
            // HEIC and other formats arrive as something UIImage can always
            // decode.
            configuration.preferredAssetRepresentationMode = .compatible

            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            self.pendingCall = call
            self.presentedPicker = picker
            presenter.present(picker, animated: true)
        }
    }

    // MARK: - PHPickerViewControllerDelegate

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        presentedPicker = nil
        guard let call = pendingCall else { return }
        pendingCall = nil

        // No result: the user cancelled.
        guard let provider = results.first?.itemProvider else {
            call.resolve(["cancelled": true])
            return
        }
        guard provider.canLoadObject(ofClass: UIImage.self) else {
            call.reject("That photo can't be read.", "unreadable")
            return
        }
        // Called on a background queue; the encode stays there.
        _ = provider.loadObject(ofClass: UIImage.self) { object, _ in
            guard let image = object as? UIImage,
                  let jpeg = GolfMeMediaPickerPlugin.jpegData(for: image) else {
                call.reject("That photo can't be read.", "unreadable")
                return
            }
            call.resolve([
                "kind": "image",
                "mimeType": "image/jpeg",
                "base64": jpeg.base64EncodedString()
            ])
        }
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
