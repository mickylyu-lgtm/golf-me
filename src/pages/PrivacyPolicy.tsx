import { useNavigate } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";

// Standalone, outside both GuestOnly and AuthedLayout (see App.tsx) — this
// has to be viewable by someone who doesn't have an account yet, and by
// Apple/Google reviewers, neither of whom will ever have a session.
// Deliberately plain English, not routed through i18n, same reasoning as
// CommunityGuidelines.tsx: this needs to say exactly one precise thing in
// one language, not be re-derived per locale.
//
// Reflects what this codebase actually does as of the date below, checked
// directly against the schema, RLS policies, Edge Functions and frontend
// integrations (see APP_STORE_PRIVACY.md for the evidence and the App Store
// privacy answers) — update this file, the date, and APP_STORE_PRIVACY.md if
// the data collected or the third parties involved change.
const LAST_UPDATED = "September 29, 2026";
const CONTACT_EMAIL = "mickylyu@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-semibold text-slate-800">{label}:</span> {children}
    </p>
  );
}

export function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-6 sm:px-6"
      style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
    >
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Lock size={20} className="text-fairway-600" /> Privacy Policy
        </h1>
        <p className="mt-1 text-sm text-slate-500">Last updated {LAST_UPDATED}</p>
      </div>

      <Section title="The short version">
        <p>
          GolfMe is a social app for finding golf rounds and golfers to play with. We collect what's needed to run that — your profile,
          the rounds, messages and posts you're part of, and your location only when you choose to share it. We don't sell your data, we
          don't show ads, and we don't track you across other apps or websites. We use privacy-friendly page-view analytics that aren't
          linked to your account.
        </p>
      </Section>

      <Section title="Who we are">
        <p>
          GolfMe is operated by Micky Lyu. If you have questions about this policy or your data, contact{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-fairway-700 hover:underline">
            {CONTACT_EMAIL}
          </a>
          . See also our{" "}
          <button onClick={() => navigate("/terms")} className="font-semibold text-fairway-700 hover:underline">
            Terms of Service
          </button>
          .
        </p>
      </Section>

      <Section title="Information we collect">
        <Item label="Account">
          Your email address and sign-in details. If you sign in with Google, we receive your name, email and profile picture from Google —
          nothing else.
        </Item>
        <Item label="Profile">
          Your name, username, profile photo, age range, gender, short bio, handicap and skill level, language, home playing area, favorite
          courses, and your match preferences (availability, budget, travel radius, walking or cart, pace, group type, game format, and any
          age, gender or handicap preferences you set).
        </Item>
        <Item label="Location">
          If you allow it, your device location is used to show nearby courses, rounds and golfers. It's rounded on your device to about
          1 km (under a mile) before it's sent or saved, so we only ever store an approximate playing area — never your exact position —
          and you can enter an area manually instead. When you search for courses, that approximate location is sent to our
          course-search provider.
        </Item>
        <Item label="Content you create">
          Golf Calls you host or join, direct messages and round group chats, Community posts, comments, likes, saved and hidden posts,
          photos and videos you upload, follows, reviews you leave about golfers you've played with (including optional private notes),
          reports you file, blocks, booking-proof screenshots you attach to a round, and swing reviews if you're a coach reviewer.
        </Item>
        <Item label="Caddie swing videos">
          Swing videos you upload to Caddie and the AI-generated analysis produced from them (score, feedback and body-position data).
          Caddie videos are private to you unless you choose to share one to the Community.
        </Item>
        <Item label="Activity and reputation">
          Rounds you've completed and the ratings other golfers give you (show-up, on-time, pace, respect, would play again), which we
          combine into your GolfMe reputation.
        </Item>
        <Item label="Notifications">
          If you turn on push notifications, a device token from Apple that lets us send notifications to your phone, and your
          notification setting.
        </Item>
        <Item label="Waitlist">
          If you joined our waitlist, your email address, home golf area and how you heard about us.
        </Item>
        <Item label="Usage and technical data">
          We use Vercel Web Analytics to count page views on our website and app: the page visited, the referring site, your browser or
          device type, and your approximate country. It doesn't use cookies, isn't linked to your account, and isn't used for advertising.
          Our service providers also keep standard technical logs (such as IP address and device information) to keep the service secure
          and working.
        </Item>
        <Item label="What we don't collect">
          We don't collect payment or financial information (GolfMe doesn't process payments), your contacts, or your precise location in
          the background.
        </Item>
      </Section>

      <Section title="How we use it">
        <p>
          To run GolfMe: create your account, show you nearby rounds and golfers and suggest good matches, deliver messages and
          notifications, show your posts to other members, give you Caddie swing feedback, build your reputation from rounds you've
          played, keep the community safe (reviewing reports, enforcing blocks and our Terms), and understand overall usage so we can
          improve the app. We use your email to send sign-in links and account notices — never marketing without your consent.
        </p>
      </Section>

      <Section title="Who can see your information">
        <p>
          GolfMe is a social app. Other signed-in GolfMe members can see your profile (including the profile details and approximate
          playing area listed above, and your reputation), your posts and comments, who you follow, and the Golf Calls you host or have
          joined. Direct messages and round group chats are visible only to the people in them. Reviews you write, their private notes,
          your reports and your booking proofs are not shown to other members (GolfMe admins can see reports and booking proofs to keep
          the community safe). Photos and videos you post to the Community can be viewed by anyone who has their link.
        </p>
        <p>
          Push notifications for messages show the sender's name and a short preview of the message on your lock screen. You can hide
          previews in your iPhone's notification settings.
        </p>
      </Section>

      <Section title="Service providers we share it with">
        <p>We don't sell your data to anyone. GolfMe runs on a small number of service providers who process data on our behalf:</p>
        <ul className="ml-4 flex list-disc flex-col gap-1.5">
          <li>
            <span className="font-semibold text-slate-800">Supabase</span> — our database, sign-in, file storage and real-time messaging.
            Nearly everything described above is stored here, on servers in Canada.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Vercel</span> — hosts the GolfMe website and app, and provides the page-view
            analytics described above.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Apple Push Notification service</span> — delivers push notifications to your
            iPhone, including the sender's name and message preview.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Google (sign-in)</span> — only if you choose "Continue with Google".
          </li>
          <li>
            <span className="font-semibold text-slate-800">Google Gemini API</span> — used only if you use Caddie: your swing video is
            temporarily uploaded to generate your written feedback (deleted from Google's side right after), and if you translate
            feedback into another language, that text is sent to be translated.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Roboflow</span> — used only if you use Caddie: frames from your swing video are
            sent to detect your body position for the analysis.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Geoapify</span> — powers course search; your search location is sent to find
            nearby courses.
          </li>
          <li>
            <span className="font-semibold text-slate-800">GolfCourseAPI</span> — provides course details; only course names are sent,
            never information about you.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Resend</span> — sends our emails, such as sign-in links and waitlist notices.
          </li>
        </ul>
        <p>We may also disclose information if the law requires it, or to protect the safety of our members or others.</p>
      </Section>

      <Section title="Your choices">
        <p>
          You can edit your profile and remove most of your content directly in the app, change your location or enter it manually, and
          turn notifications off. You can delete your account entirely from Me → Settings → Account — this permanently deletes your
          profile and virtually everything tied to it (posts, comments, messages, Golf Call history, reviews, follows, Caddie history,
          booking proofs, device tokens). A small amount of information may be kept in anonymized form for safety records — for example,
          a report that named you stays on file with your identity removed from it. To ask about, correct or delete your data (including
          a waitlist entry), email us at the address above.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your information for as long as your account is active, and delete it when you delete your account (except the
          anonymized safety records described above). Waitlist entries are kept until you ask us to remove them. Technical logs kept by
          our providers are deleted on their standard schedules.
        </p>
      </Section>

      <Section title="Age requirement">
        <p>
          GolfMe is only for adults 18 and older. We don't knowingly collect information from anyone under 18; if we learn that we have,
          we'll delete it.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we change what we collect or how we use it in a meaningful way, we'll update this page, change the date at the top, and let
          you know in the app when the change matters to you.
        </p>
      </Section>
    </div>
  );
}

// Shared with TermsOfService.tsx so the contact address lives in one place.
export { CONTACT_EMAIL };
