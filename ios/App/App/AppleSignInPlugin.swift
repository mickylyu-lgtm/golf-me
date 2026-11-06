import Foundation
import UIKit
import WebKit
import Capacitor
import AuthenticationServices
import CryptoKit

// Native Sign in with Apple (ASAuthorizationController), exposed to the web
// app as the "GolfMeAppleSignIn" Capacitor plugin. Lives in the app target
// instead of an npm plugin: @capacitor-community/apple-sign-in 7.x pins
// capacitor-swift-pm below 8.0.0 (conflicts with Capacitor 8 under SPM), and
// @capgo/capacitor-social-login bundles the Google and Facebook SDKs and logs
// tokens to the console. This file is the whole Apple surface.
//
// Registered by GolfMeBridgeViewController (below), so the web code can tell
// a build that has it from one that doesn't with
// Capacitor.isPluginAvailable("GolfMeAppleSignIn"). Builds without this file
// never show the Apple button.
//
// Nonce: the web passes a random raw nonce; Apple gets its SHA-256 hex (what
// ends up in the identity token's "nonce" claim) and the web sends the raw
// value to Supabase, which hashes it and compares.
@objc(GolfMeAppleSignInPlugin)
public class GolfMeAppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "GolfMeAppleSignInPlugin"
    public let jsName = "GolfMeAppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    // Held so the controller isn't released while Apple's sheet is up.
    private var authorizationController: ASAuthorizationController?

    @objc func authorize(_ call: CAPPluginCall) {
        guard let rawNonce = call.getString("nonce"), !rawNonce.isEmpty else {
            call.reject("A nonce is required.", "invalid_argument")
            return
        }
        // Name and email are only ever returned on the first authorization
        // for this Apple ID + app; false is used for the account-deletion
        // re-authorization, which only needs a fresh authorization code.
        let requestScopes = call.getBool("requestScopes") ?? true

        DispatchQueue.main.async {
            if self.pendingCall != nil {
                call.reject("Sign in with Apple is already in progress.", "in_progress")
                return
            }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = requestScopes ? [.fullName, .email] : []
            request.nonce = GolfMeAppleSignInPlugin.sha256Hex(rawNonce)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.pendingCall = call
            self.authorizationController = controller
            controller.performRequests()
        }
    }

    private func takePendingCall() -> CAPPluginCall? {
        let call = pendingCall
        pendingCall = nil
        authorizationController = nil
        return call
    }

    static func sha256Hex(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - ASAuthorizationControllerDelegate

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = takePendingCall() else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple did not return an identity token.", "no_identity_token")
            return
        }

        // Only non-nil values are included, so the web side sees a missing
        // key rather than a null-ish placeholder.
        var result: [String: Any] = [
            "identityToken": identityToken,
            "user": credential.user
        ]
        if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) {
            result["authorizationCode"] = code
        }
        if let email = credential.email {
            result["email"] = email
        }
        if let givenName = credential.fullName?.givenName {
            result["givenName"] = givenName
        }
        if let familyName = credential.fullName?.familyName {
            result["familyName"] = familyName
        }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = takePendingCall() else { return }
        var code = "unknown"
        if let authError = error as? ASAuthorizationError {
            switch authError.code {
            case .canceled: code = "canceled"
            case .failed: code = "failed"
            case .invalidResponse: code = "invalid_response"
            case .notHandled: code = "not_handled"
            case .notInteractive: code = "not_interactive"
            default: code = "unknown"
            }
        }
        call.reject(error.localizedDescription, code, error)
    }

    // MARK: - ASAuthorizationControllerPresentationContextProviding

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first ?? UIWindow()
    }
}

// The web app's Appearance setting (Settings -> Appearance: Light / Dark /
// Match iPhone), exposed as the "GolfMeAppearance" Capacitor plugin. The web
// app can be Dark on a Light iPhone; without this the status bar text, native
// sheets (photo picker, camera, share, Apple sign-in) and the web view's own
// backdrop kept following the iPhone. setAppearance overrides the window's
// interface style, which every native surface in the window follows; the web
// view's prefers-color-scheme follows it too, which is why the web sends the
// setting ("system"), never the resolved scheme, for Match iPhone: otherwise
// the override would feed back into what the web reads as "the iPhone".
// Web side: src/lib/nativeAppearance.ts (skips the call on builds without
// this plugin). Not persisted natively: the web sends it at startup while
// the launch screen is still up.
@objc(GolfMeAppearancePlugin)
public class GolfMeAppearancePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GolfMeAppearancePlugin"
    public let jsName = "GolfMeAppearance"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise)
    ]

    @objc func setAppearance(_ call: CAPPluginCall) {
        let style: UIUserInterfaceStyle
        switch call.getString("appearance") {
        case "light": style = .light
        case "dark": style = .dark
        case "system": style = .unspecified
        default:
            call.reject("appearance must be light, dark or system.", "invalid_argument")
            return
        }
        DispatchQueue.main.async {
            (self.bridge?.viewController as? GolfMeBridgeViewController)?.applyInterfaceStyle(style)
            call.resolve()
        }
    }
}

// Root view controller (created in SceneDelegate). Same as Capacitor's own,
// plus registering the app-local plugins (above, and MediaPickerPlugin.swift)
// before the web view loads, keeping iOS 26+'s top scroll edge effect off the
// web view, and a page colour behind the web view that follows light/dark.
class GolfMeBridgeViewController: CAPBridgeViewController {
    private var edgeEffectObservations: [NSKeyValueObservation] = []

    // What shows wherever WebKit hasn't painted yet (keyboard open/close,
    // the rounded keyboard corners, a resize mid-animation): the page's own
    // colour in each mode, the cream #faf9f6 in light (as capacitor.config.ts
    // backgroundColor) and html.dark's #0d1210 in dark (index.html), so the
    // reveal is invisible instead of a cream flash on the dark app.
    static let pageBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x0d / 255.0, green: 0x12 / 255.0, blue: 0x10 / 255.0, alpha: 1)
            : UIColor(red: 0xfa / 255.0, green: 0xf9 / 255.0, blue: 0xf6 / 255.0, alpha: 1)
    }

    func applyInterfaceStyle(_ style: UIUserInterfaceStyle) {
        guard let window = view.window else { return }
        if window.overrideUserInterfaceStyle != style {
            window.overrideUserInterfaceStyle = style
        }
        setNeedsStatusBarAppearanceUpdate()
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GolfMeAppleSignInPlugin())
        bridge?.registerPluginInstance(GolfMeAppearancePlugin())
        bridge?.registerPluginInstance(GolfMeMediaPickerPlugin())
        hideTopScrollEdgeEffect()
        guard let webView = webView else { return }
        // Replaces the fixed cream Capacitor set from capacitor.config.ts
        // backgroundColor (same colour in light mode).
        webView.backgroundColor = Self.pageBackground
        webView.scrollView.backgroundColor = Self.pageBackground
        // WebKit manages the scroll view's edge effect itself (iOS 26 scroll
        // pockets) and can turn it back on after a page load or a scroll,
        // which is why setting it once here (89650c0) wasn't enough on
        // device. Re-hide after every load state change and offset change;
        // the setter is skipped when it's already hidden, so this is cheap.
        edgeEffectObservations = [
            webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.hideTopScrollEdgeEffect() }
            },
            webView.scrollView.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                self?.hideTopScrollEdgeEffect()
            }
        ]
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        hideTopScrollEdgeEffect()
    }

    // The root view is the web view itself (CAPBridgeViewController sets
    // view = webView), so this runs right after every web view layout pass.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        hideTopScrollEdgeEffect()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        hideTopScrollEdgeEffect()
        #if DEBUG
        // Xcode-run (Debug) builds only: says in the console whether the
        // flag stuck, and which of WebKit's own views might be drawing a
        // band under the status bar if it did and the band is still there.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.logTopEdgeDiagnostics()
        }
        #endif
    }

    // iOS 26 draws a scroll edge effect (a soft blur/fade, lightened in Light
    // Mode) on a scroll view's top edge under the status bar. The web view is
    // edge-to-edge (contentInset "never", viewport-fit=cover) and the web app
    // paints its own status-bar area, so that effect is just a pale band over
    // the page: invisible on the cream pages, obvious over the dark green
    // EntryOverlay. Purely visual: no change to insets, frame or scrolling,
    // so the keyboard resize (KeyboardResize.Body) path is untouched. The
    // compiler check keeps this building on pre-Xcode-26 toolchains;
    // #available makes it a no-op below iOS 26.
    fileprivate func hideTopScrollEdgeEffect() {
        webView?.golfMeHideTopScrollEdgeEffect()
    }

    #if DEBUG
    private func logTopEdgeDiagnostics() {
        guard let webView = webView else { return }
        var lines: [String] = []
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            lines.append("topEdgeEffect.isHidden=\(webView.scrollView.topEdgeEffect.isHidden) style=\(webView.scrollView.topEdgeEffect.style)")
        }
        #endif
        lines.append("safeAreaInsets=\(webView.safeAreaInsets) contentInset=\(webView.scrollView.contentInset) adjusted=\(webView.scrollView.adjustedContentInset)")
        func walk(_ view: UIView, _ depth: Int) {
            guard depth < 6 else { return }
            let name = String(describing: type(of: view))
            let lower = name.lowercased()
            if lower.contains("pocket") || lower.contains("edge") || lower.contains("blur") || lower.contains("effect") || lower.contains("extension") {
                lines.append("\(String(repeating: "  ", count: depth))\(name) frame=\(view.frame) hidden=\(view.isHidden) alpha=\(view.alpha)")
            }
            view.subviews.forEach { walk($0, depth + 1) }
        }
        walk(webView, 0)
        print("[GolfMe top edge]\n" + lines.joined(separator: "\n"))
    }
    #endif
}

extension WKWebView {
    func golfMeHideTopScrollEdgeEffect() {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let effect = scrollView.topEdgeEffect
            if !effect.isHidden {
                effect.isHidden = true
            }
        }
        #endif
    }
}
