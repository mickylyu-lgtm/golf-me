import Foundation
import UIKit
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

// Root view controller (created in SceneDelegate). Same as Capacitor's own,
// plus registering the app-local plugins above before the web view loads.
class GolfMeBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GolfMeAppleSignInPlugin())
    }
}
