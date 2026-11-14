# Notification extension checks

On a Mac with Xcode, run the bounded downloader tests (synthetic URLProtocol;
no network requests):

```sh
swiftc ios/App/NotificationService/AvatarDownload.swift tests/native/AvatarDownloadTests.swift -o /tmp/golfme-avatar-tests
/tmp/golfme-avatar-tests
```

The service tests compile the actual extension sources into a separate temporary
XCTest bundle. Requires the `xcodeproj` Ruby gem; it does not modify App's targets.

```sh
ruby tests/native/make-project.rb
xcodebuild -project /tmp/GolfMeNotificationTests.xcodeproj -scheme NotificationTests -destination 'platform=iOS Simulator,name=YOUR_SIMULATOR' -derivedDataPath /tmp/golfme-tests-derived test
```

These tests cover original system payload delivery, duplicate expiry, image
rejection/downsampling, initials/person glyph generation, and missing-avatar
handling raced against expiry. They do not prove lock-screen rendering or APNs
behavior. Verify DM avatar + GolfMe badge, missing-avatar initials, unchanged
round-update icon, and poor-network delivery on a physical iPhone via TestFlight.
