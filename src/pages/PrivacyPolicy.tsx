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
// directly against the schema and code rather than written from a generic
// template — update this file (and the date) if the data collected or the
// third parties involved change.
const LAST_UPDATED = "August 20, 2026";
const CONTACT_EMAIL = "mickylyu@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

export function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
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
          the rounds and messages you're part of, and location only when you choose to use it. We don't sell your data, and we don't run
          ads or third-party trackers in the app.
        </p>
      </Section>

      <Section title="Who we are">
        <p>
          GolfMe is operated by Micky Lyu. If you have questions about this policy or your data, contact{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-fairway-700 hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          <span className="font-semibold text-slate-800">Account information:</span> Email address, name, profile photo, handicap, and
          your general home/playing area. If you sign in with Google, we receive your name, email, and profile picture from Google —
          nothing else.
        </p>
        <p>
          <span className="font-semibold text-slate-800">Location:</span> Your precise device location, only if you grant permission and
          only to show you nearby courses and rounds. You can always enter a location manually instead. Your general playing area (a
          region, not exact coordinates) is saved to your profile to personalize what you see.
        </p>
        <p>
          <span className="font-semibold text-slate-800">Content you create:</span> Golf Calls you host or join, direct messages and
          group round chat, Community posts and comments (including photos and videos you upload), reviews you leave about golfers
          you've played with, reports you file, and booking-proof screenshots you attach to a round.
        </p>
        <p>
          <span className="font-semibold text-slate-800">What we don't collect:</span> We don't have any advertising or analytics
          tracking in the app, and we don't collect payment or financial information — GolfMe doesn't process payments.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          To run the core app: create your account, match you with nearby rounds and golfers, deliver messages, show your posts to
          other users, and let you build a credibility history from rounds you've played. We also use your email to send account-related
          notices (like magic-link sign-in emails) — never marketing without your consent.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>We don't sell your data to anyone. GolfMe runs on a small number of service providers who process data on our behalf:</p>
        <ul className="ml-4 flex list-disc flex-col gap-1.5">
          <li>
            <span className="font-semibold text-slate-800">Supabase</span> — our database, authentication, file storage, and real-time
            messaging infrastructure. Nearly everything described above is stored here.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Google</span> — only if you choose "Continue with Google" to sign in.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Geoapify</span> — powers course search and location lookup; your search
            location is sent to them to find nearby courses.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Resend</span> — sends transactional email (for example, notifying us when
            someone joins the GolfMe waitlist).
          </li>
          <li>
            <span className="font-semibold text-slate-800">Vercel</span> — hosts the GolfMe website and app.
          </li>
        </ul>
        <p>
          Other GolfMe users can see what you'd expect from a social app: your public profile, posts, and any Golf Call you're
          hosting or have joined. Direct messages and group round chat are only visible to their participants.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can edit or remove most of your content directly in the app. You can delete your account entirely from Me → Settings →
          Account — this permanently deletes your profile and virtually everything tied to it (posts, comments, messages, Golf Call
          history, reviews, follows, Caddie history, booking proofs). A small amount of information may be kept in anonymized form for
          safety records — for example, a report that named you stays on file with your identity removed from it, the same way most
          platforms handle moderation history. If you'd like confirmation that a specific piece of data has been fully removed, email
          us at the address above.
        </p>
      </Section>

      <Section title="Children">
        <p>GolfMe is not directed at children, and we don't knowingly collect information from anyone under 13.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we change what we collect or how we use it in a meaningful way, we'll update this page and change the date at the top.
        </p>
      </Section>
    </div>
  );
}
