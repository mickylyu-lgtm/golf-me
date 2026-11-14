// GolfMe Notification Service Extension: the sender's round photo on
// person-originated pushes (DMs, round joins, comments, likes, follows), the
// iOS "Communication Notification" look iMessage/WhatsApp/Instagram use. iOS
// draws the photo and overlays the GolfMe icon as a small badge itself.
//
// Server side: send-push adds aps.mutable-content = 1 and a `sender` block
//   { id, avatar_url?, initials, colors: [fromHex, toHex] }
// only when the push comes from a person (supabase/functions/_shared/
// communicationPush.ts). System pushes (round updates, Caddie) carry no
// `sender` and pass straight through untouched.
//
// SAFETY CONTRACT (a broken extension must never cost a notification):
//   * contentHandler is called exactly once, guarded by a lock + flag.
//   * Any missing/odd field, failed or slow download, undecodable image,
//     missing entitlement (updating(from:) throws) -> the ORIGINAL content,
//     i.e. exactly today's notification with the app icon.
//   * The avatar download has its own 8 s timeout and a 1.5 MB cap, well
//     inside the ~30 s iOS gives an extension; if iOS still calls
//     serviceExtensionTimeWillExpire first, the original content goes out.
//   * The image is downsampled with ImageIO (never fully decoded), so a huge
//     file can't push the extension over its small memory limit.
//   * Only this project's HTTPS public avatar objects owned by the sender
//     are fetched; no redirects, cookies, cache, or auth.
// No photo -> a monogram (the golfer's initials on their in-app avatar
// gradient), not the app icon: it reads as a person, like Contacts/iMessage.
//
// Built by the embedded NotificationService target.

import ImageIO
import Intents
import UIKit
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private static let imagePixels: CGFloat = 256

    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var originalContent: UNNotificationContent?
    private var finished = false
    private var avatarDownload: AvatarDownload?
    private var deadline: DispatchWorkItem?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.lock()
        self.contentHandler = contentHandler
        self.originalContent = request.content
        let timeout = DispatchWorkItem { [weak self] in self?.finish(with: request.content) }
        deadline = timeout
        lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: timeout)

        guard let sender = Sender(userInfo: request.content.userInfo), !request.content.title.isEmpty else {
            finish(with: request.content)
            return
        }

        guard let url = sender.avatarURL else {
            present(request.content, sender: sender, photo: nil)
            return
        }

        let download = AvatarDownload()
        lock.lock()
        guard !finished else { lock.unlock(); return }
        avatarDownload = download
        lock.unlock()
        download.start(url: url) { data in
            guard let data, let photo = Self.downsampledImage(from: data) else {
                self.finish(with: request.content)
                return
            }
            self.present(request.content, sender: sender, photo: photo)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        lock.lock()
        let original = originalContent
        lock.unlock()
        if let original { finish(with: original) }
    }

    // MARK: - Delivery

    private func present(_ content: UNNotificationContent, sender: Sender, photo: INImage?) {
        lock.lock()
        let alreadyFinished = finished
        lock.unlock()
        guard !alreadyFinished else { return }
        let image = photo ?? Self.monogram(initials: sender.initials, colors: sender.colors)
        let person = INPerson(
            personHandle: INPersonHandle(value: sender.id, type: .unknown),
            nameComponents: nil,
            displayName: content.title,
            image: image,
            contactIdentifier: nil,
            customIdentifier: sender.id
        )
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: nil,
            conversationIdentifier: sender.threadId,
            serviceName: nil,
            sender: person,
            attachments: nil
        )
        if let image {
            intent.setImage(image, forParameterNamed: \.sender)
        }
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { _ in
            // A failed donation is not fatal: updating(from:) decides the look.
            do {
                let updated = try content.updating(from: intent)
                self.finish(with: updated)
            } catch {
                // e.g. the Communication Notifications entitlement is missing.
                self.finish(with: content)
            }
        }
    }

    private func finish(with content: UNNotificationContent) {
        lock.lock()
        guard !finished, let handler = contentHandler else {
            lock.unlock()
            return
        }
        finished = true
        contentHandler = nil
        let download = avatarDownload
        avatarDownload = nil
        let timeout = deadline
        deadline = nil
        lock.unlock()
        timeout?.cancel()
        download?.cancel()
        handler(content)
    }

    // MARK: - Images

    /// Decodes at most a 256 px thumbnail (ImageIO), never the full bitmap.
    static func downsampledImage(from data: Data) -> INImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0 else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: imagePixels,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let png = UIImage(cgImage: thumbnail).pngData() else { return nil }
        return INImage(imageData: png)
    }

    /// Initials on the golfer's avatar gradient (top-left to bottom-right, as
    /// in the app). iOS crops it to a circle. No initials -> a person glyph.
    static func monogram(initials: String, colors: (UIColor, UIColor)) -> INImage? {
        let size = CGSize(width: imagePixels, height: imagePixels)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            let rect = CGRect(origin: .zero, size: size)
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                         colors: [colors.0.cgColor, colors.1.cgColor] as CFArray,
                                         locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            } else {
                colors.1.setFill()
                cg.fill(rect)
            }

            if initials.isEmpty {
                let config = UIImage.SymbolConfiguration(pointSize: size.width * 0.42, weight: .regular)
                if let glyph = UIImage(systemName: "person.fill", withConfiguration: config)?
                    .withTintColor(.white, renderingMode: .alwaysOriginal) {
                    let origin = CGPoint(x: (size.width - glyph.size.width) / 2, y: (size.height - glyph.size.height) / 2)
                    glyph.draw(at: origin)
                }
                return
            }

            let pointSize = size.width * (initials.count > 2 ? 0.32 : 0.4)
            let base = UIFont.systemFont(ofSize: pointSize, weight: .semibold)
            let font = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: pointSize) } ?? base
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
            let text = initials as NSString
            let textSize = text.size(withAttributes: attributes)
            text.draw(at: CGPoint(x: (size.width - textSize.width) / 2, y: (size.height - textSize.height) / 2),
                      withAttributes: attributes)
        }
        guard let png = rendered.pngData() else { return nil }
        return INImage(imageData: png)
    }
}

// MARK: - Payload

private struct Sender {
    let id: String
    let avatarURL: URL?
    let initials: String
    let colors: (UIColor, UIColor)
    let threadId: String

    // GolfMe fairway green, the app's fallback avatar colour.
    private static let fairway500 = UIColor(red: 0x22 / 255.0, green: 0xC5 / 255.0, blue: 0x5E / 255.0, alpha: 1)
    private static let fairway700 = UIColor(red: 0x15 / 255.0, green: 0x80 / 255.0, blue: 0x3D / 255.0, alpha: 1)

    init?(userInfo: [AnyHashable: Any]) {
        guard let raw = userInfo["sender"] as? [String: Any],
              let id = raw["id"] as? String, !id.isEmpty, id.count <= 64 else { return nil }
        self.id = id
        self.avatarURL = (raw["avatar_url"] as? String).flatMap { AvatarDownload.trustedURL($0, senderID: id) }
        let initials = ((raw["initials"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        self.initials = String(initials.prefix(3))
        let hex = (raw["colors"] as? [String]) ?? []
        self.colors = (
            Sender.color(hex: hex.first) ?? Sender.fairway500,
            Sender.color(hex: hex.count > 1 ? hex[1] : nil) ?? Sender.fairway700
        )
        let aps = userInfo["aps"] as? [String: Any]
        let thread = (aps?["thread-id"] as? String) ?? ""
        self.threadId = thread.isEmpty ? "person-\(id)" : thread
    }

    static func color(hex: String?) -> UIColor? {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
        s.removeFirst()
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
