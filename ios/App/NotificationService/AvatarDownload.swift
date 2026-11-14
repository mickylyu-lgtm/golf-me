import Foundation

/// Streams into a bounded buffer; all exit paths cancel and complete once.
final class AvatarDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let maxBytes = 1_500_000
    private let lock = NSLock()
    private var buffer = Data()
    private var completed = false
    private var completion: ((Data?) -> Void)?
    private var session: URLSession?
    private var deadline: DispatchWorkItem?

    static func trustedURL(_ value: String, senderID: String) -> URL? {
        guard value.count <= 512, UUID(uuidString: senderID) != nil,
              let parts = URLComponents(string: value),
              parts.scheme == "https", parts.host == "adokdenbmpshqgjbzshb.supabase.co",
              parts.port == nil, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              !parts.percentEncodedPath.contains("%"),
              !parts.path.contains("\\"),
              !parts.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
              parts.path.hasPrefix("/storage/v1/object/public/avatars/\(senderID)/"),
              !parts.path.hasSuffix("/"), let url = parts.url else { return nil }
        return url
    }

    func start(url: URL, configuration: URLSessionConfiguration = .ephemeral,
               timeout: TimeInterval = 8, completion: @escaping (Data?) -> Void) {
        lock.lock()
        guard !completed, session == nil else { lock.unlock(); completion(nil); return }
        self.completion = completion
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        let deadline = DispatchWorkItem { [weak self] in self?.finish(nil) }
        self.deadline = deadline
        let task = session.dataTask(with: url)
        task.resume()
        lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
    }

    func cancel() { finish(nil) }

    private func finish(_ data: Data?) {
        lock.lock()
        guard !completed else { lock.unlock(); return }
        completed = true
        let callback = completion
        completion = nil
        let current = session
        session = nil
        let timer = deadline
        deadline = nil
        buffer.removeAll()
        lock.unlock()
        timer?.cancel()
        current?.invalidateAndCancel()
        callback?(data)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              (http.mimeType ?? "").hasPrefix("image/"),
              response.expectedContentLength <= Int64(Self.maxBytes) else {
            completionHandler(.cancel)
            finish(nil)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !completed else { lock.unlock(); return }
        guard data.count <= Self.maxBytes - buffer.count else {
            lock.unlock()
            finish(nil)
            return
        }
        buffer.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let result = error == nil && !buffer.isEmpty ? buffer : nil
        lock.unlock()
        finish(result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(nil)
    }
}
