import { useNavigate } from "react-router-dom";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { CONTACT_EMAIL } from "./PrivacyPolicy";
import { goBack } from "../lib/goBack";

// Public support page — the App Store Connect "Support URL". Standalone,
// outside GuestOnly and AuthedLayout (see App.tsx) like /privacy and /terms,
// so it works without an account. Plain English, not routed through i18n,
// for the same reason as the legal pages. The contact address comes from
// PrivacyPolicy.tsx so it lives in one place. The logged-in Help Center
// (/help) stays as the in-app help screen.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

export function Support() {
  const navigate = useNavigate();
  const link = "font-semibold text-fairway-700 hover:underline";

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-6 sm:px-6"
      style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
    >
      <button
        onClick={() => goBack(navigate)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <LifeBuoy size={20} className="text-fairway-600" /> GolfMe Support
        </h1>
        <p className="mt-1 text-sm text-slate-500">We're here to help.</p>
      </div>

      <Section title="Contact us">
        <p>
          Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}?subject=GolfMe%20support`} className={link}>
            {CONTACT_EMAIL}
          </a>{" "}
          with a short description of what happened, and the email address you use for GolfMe if it's a different one. We read every
          message and aim to reply within 2 business days. If you're signed in, you can also message the founder directly in the app —
          it's the welcome chat in your Messages.
        </p>
      </Section>

      <Section title="Signing in">
        <p>
          <span className="font-semibold text-slate-800">On the web:</span> Continue with Google, or Continue with Email. With email,
          we send you a 6-digit code: type it on the sign-in screen. The same email also has a sign-in link, which only works on the
          device where you tap it.
        </p>
        <p>
          <span className="font-semibold text-slate-800">In the iPhone app:</span> Sign in with Apple, Continue with Google, or
          Continue with Email. With email, use the 6-digit code — it works even if you read the email on another device, and you
          stay in the app. Tapping the link in the email may open Safari instead of the app. If you only see email and "Sign in with
          a password", update the app to the latest version.
        </p>
        <p>
          Signing in with Google or Apple uses the account that has the same email address, so you keep your profile. If you choose
          Apple's Hide My Email, GolfMe only sees a private relay address, which becomes a separate account.
        </p>
        <p>
          A code or link stops working once it's been used or after a while (some email apps open links automatically, which uses
          them up). Ask for a new one from the sign-in screen; you can request another after a minute. Check your spam folder if the
          email doesn't arrive within a few minutes. Still stuck? Email us from the address you sign in with.
        </p>
      </Section>

      <Section title="Your profile and rounds">
        <p>
          Edit your profile, location and match preferences from the Me tab. To host a round, use Host a Round; to join one, open it from
          Play and tap Join. You can leave a round you've joined, and hosts can edit or cancel their own rounds from the round's page.
        </p>
      </Section>

      <Section title="Safety, reporting and blocking">
        <p>
          You can report or block any golfer from their profile, a chat, a round or a post. Reports are reviewed, and content or accounts
          that break our{" "}
          <button onClick={() => navigate("/terms")} className={link}>
            Terms of Service
          </button>{" "}
          are removed. When you meet other golfers in person, meet at the course and use good judgment. If you're in danger, contact local
          emergency services first (911 in the US).
        </p>
      </Section>

      <Section title="Notifications">
        <p>
          Push notifications are available in the iPhone app; turn them on or off under Me → Settings. On the web, updates appear
          under the bell at the top of the app. To hide message previews on your lock screen, change "Show Previews" for GolfMe in
          your iPhone's Settings → Notifications.
        </p>
      </Section>

      <Section title="Caddie swing analysis">
        <p>
          For the best results, film in good light with your whole body in frame for the entire swing, from face-on or down the line.
          Analysis usually takes a minute or two and keeps running if you leave the app. There's a daily limit on analyses. Caddie is AI
          feedback, not professional instruction.
        </p>
      </Section>

      <Section title="Deleting your account">
        <p>
          Go to Me → Settings → Account → Delete Account. This permanently deletes your profile and virtually everything tied to it, as
          described in our{" "}
          <button onClick={() => navigate("/privacy")} className={link}>
            Privacy Policy
          </button>
          . If you can't sign in anymore, email us from the address on your account and we'll delete it for you.
        </p>
      </Section>
    </div>
  );
}
