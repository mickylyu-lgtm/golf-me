import XCTest
import UIKit
import UserNotifications

final class NotificationServiceTests: XCTestCase {
    func testSystemPushPassesThroughAndExpiryDoesNotRedeliver() {
        let service = NotificationService()
        let content = UNMutableNotificationContent()
        content.title = "Round updated"
        content.body = "New tee time"
        var calls = 0
        service.didReceive(UNNotificationRequest(identifier: "system", content: content, trigger: nil)) { delivered in
            calls += 1
            XCTAssertEqual(delivered.title, content.title)
            XCTAssertEqual(delivered.body, content.body)
            XCTAssertTrue(delivered.userInfo.isEmpty)
        }
        service.serviceExtensionTimeWillExpire()
        service.serviceExtensionTimeWillExpire()
        XCTAssertEqual(calls, 1)
    }

    func testMissingAvatarCreatesMonogramAndInvalidImageFails() {
        XCTAssertNotNil(NotificationService.monogram(initials: "ML", colors: (.green, .black)))
        XCTAssertNotNil(NotificationService.monogram(initials: "", colors: (.green, .black)))
        XCTAssertNil(NotificationService.downsampledImage(from: Data("invalid image".utf8)))
        let image = UIGraphicsImageRenderer(size: CGSize(width: 500, height: 500)).image { c in
            UIColor.green.setFill(); c.fill(CGRect(x: 0, y: 0, width: 500, height: 500))
        }
        XCTAssertNotNil(NotificationService.downsampledImage(from: image.pngData()!))
    }

    func testMissingAvatarAndExpiryDeliverExactlyOnce() {
        let service = NotificationService()
        let content = UNMutableNotificationContent()
        content.title = "Synthetic Golfer"
        content.body = "Synthetic message"
        content.userInfo = ["sender": ["id": "11111111-1111-4111-8111-111111111111", "initials": "SG"]]
        let delivered = expectation(description: "delivered once")
        delivered.assertForOverFulfill = true
        service.didReceive(UNNotificationRequest(identifier: "missing-avatar", content: content, trigger: nil)) { result in
            XCTAssertEqual(result.body, content.body)
            delivered.fulfill()
        }
        service.serviceExtensionTimeWillExpire()
        service.serviceExtensionTimeWillExpire()
        wait(for: [delivered], timeout: 2)
        let settle = expectation(description: "late donation completion settles")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { settle.fulfill() }
        wait(for: [settle], timeout: 2)
    }
}
