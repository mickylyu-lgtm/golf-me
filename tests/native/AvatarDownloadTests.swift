// Run: swiftc ios/App/NotificationService/AvatarDownload.swift tests/native/AvatarDownloadTests.swift -o /tmp/golfme-avatar-tests && /tmp/golfme-avatar-tests
import Foundation

final class MockAvatarProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let mode = request.url!.lastPathComponent
        if mode == "timeout" { return }
        if mode == "error" { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return }
        let size = mode == "declared-large" ? "1500001" : "-1"
        let response = HTTPURLResponse(url: request.url!, statusCode: mode == "http" ? 403 : 200,
            httpVersion: nil, headerFields: ["Content-Type": mode == "mime" ? "text/html" : "image/png", "Content-Length": size])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if mode == "stream-large" {
            client?.urlProtocol(self, didLoad: Data(repeating: 1, count: 1_000_000))
            client?.urlProtocol(self, didLoad: Data(repeating: 2, count: 500_001))
        } else if mode != "empty" {
            client?.urlProtocol(self, didLoad: Data([1,2,3]))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct Tests {
    static func main() {
        let id = "11111111-1111-4111-8111-111111111111"
        let base = "https://adokdenbmpshqgjbzshb.supabase.co/storage/v1/object/public/avatars/\(id)/"
        precondition(AvatarDownload.trustedURL(base + "photo.png", senderID: id) != nil)
        for bad in [base + "../other.png", base + "%2e%2e/a", base + "x?token=secret", base + "x#fragment", base.replacingOccurrences(of: "https:", with: "http:") + "x", base.replacingOccurrences(of: ".co/", with: ".co.evil.test/") + "x", base.replacingOccurrences(of: ".co/", with: ".co:444/") + "x", base.replacingOccurrences(of: id, with: "22222222-2222-4222-8222-222222222222") + "x"] {
            precondition(AvatarDownload.trustedURL(bad, senderID: id) == nil, bad)
        }
        for mode in ["ok", "stream-large", "declared-large", "empty", "http", "mime", "error", "timeout", "cancel"] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [MockAvatarProtocol.self]
            let downloader = AvatarDownload()
            let done = DispatchSemaphore(value: 0)
            let lock = NSLock()
            var calls = 0
            downloader.start(url: URL(string: base + (mode == "cancel" ? "timeout" : mode))!, configuration: configuration, timeout: 0.1) { data in
                lock.lock(); calls += 1; lock.unlock()
                precondition(mode == "ok" ? data == Data([1,2,3]) : data == nil, mode)
                done.signal()
            }
            if mode == "cancel" { downloader.cancel() }
            precondition(done.wait(timeout: .now() + 2) == .success, mode)
            downloader.cancel()
            Thread.sleep(forTimeInterval: 0.15)
            lock.lock(); precondition(calls == 1, mode); lock.unlock()
            print("PASS \(mode)")
        }
        // Redirects are rejected before following even an otherwise trusted URL.
        let downloader = AvatarDownload()
        let session = URLSession(configuration: .ephemeral)
        let url = URL(string: base + "photo.png")!
        let task = session.dataTask(with: url)
        let redirect = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: nil)!
        downloader.urlSession(session, task: task, willPerformHTTPRedirection: redirect, newRequest: URLRequest(url: URL(string: "https://example.invalid")!)) { precondition($0 == nil) }
        session.invalidateAndCancel()
        print("PASS URL validation and redirect rejection")
    }
}
