import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { CONTACT_EMAIL } from "./PrivacyPolicy";

// Text approved by Micky on 2026-09-29 (review task T-20260929-74342), with
// New York as governing law. Plain-English terms, not legal advice; have a
// lawyer review them when possible.
//
// Standalone, outside both GuestOnly and AuthedLayout (see App.tsx), like
// PrivacyPolicy.tsx: it must be viewable without an account, by app reviewers
// and from the Google OAuth consent screen. Plain English, not routed through
// i18n, for the same reason as PrivacyPolicy/CommunityGuidelines: legal text
// should say one precise thing in one language.
//
// Written against what the app actually does as of the date below — update
// this file (and the date) when that changes.
const LAST_UPDATED = "September 29, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

export function TermsOfService() {
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
          <FileText size={20} className="text-fairway-600" /> Terms of Service
        </h1>
        <p className="mt-1 text-sm text-slate-500">Last updated {LAST_UPDATED}</p>
      </div>

      <Section title="The short version">
        <p>
          GolfMe helps golfers find people to play with, host and join rounds, chat, share posts, and get AI feedback on their swing. It's
          free. Be respectful, only post what you have the right to share, and use good judgment when you meet people in person — GolfMe
          connects golfers but doesn't run, supervise, or vouch for the rounds you play.
        </p>
      </Section>

      <Section title="Who we are and agreeing to these terms">
        <p>
          GolfMe is operated by Micky Lyu ("GolfMe", "we", "us"). These terms apply to the GolfMe website at golfme.app and the GolfMe iOS
          app (together, the "Service"). By creating an account or using the Service, you agree to these terms and to our{" "}
          <button onClick={() => navigate("/privacy")} className="font-semibold text-fairway-700 hover:underline">
            Privacy Policy
          </button>
          . If you don't agree, please don't use GolfMe. Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-fairway-700 hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="Who can use GolfMe">
        <p>
          You must be at least 18 years old to use GolfMe, and you confirm this when you set up your profile. You can't use GolfMe if we've
          previously removed your account, or if the law doesn't allow you to.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You sign in with Google or an email link. Keep access to your account secure — you're responsible for what happens under it. Use
          your real name or a name people know you by, and keep your profile honest: skill level, handicap, and location help other golfers
          decide whether to play with you.
        </p>
      </Section>

      <Section title="Using GolfMe respectfully">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>harass, threaten, discriminate against, or impersonate anyone;</li>
          <li>post content that is illegal, hateful, sexually explicit, violent, or that infringes someone else's rights;</li>
          <li>spam, advertise, or solicit without permission;</li>
          <li>share someone else's private information without their consent;</li>
          <li>host rounds you don't intend to show up for, or misrepresent a round, booking, or yourself;</li>
          <li>scrape, reverse-engineer, overload, or interfere with the Service, or access accounts or data that aren't yours.</li>
        </ul>
        <p>
          <span className="font-semibold text-slate-800">GolfMe has zero tolerance for objectionable content and abusive users.</span>{" "}
          Content like this is removed, and accounts that post it or abuse other golfers are suspended or removed.
        </p>
        <p>The Community Guidelines in the app explain what we expect in posts and comments; they're part of these terms.</p>
      </Section>

      <Section title="Your content">
        <p>
          You own what you post — profile details, photos, swing videos, posts, comments, and messages. To run the Service, you give GolfMe
          a non-exclusive, worldwide, royalty-free license to host, store, copy, display, and share your content with the people you share
          it with (for example, the Community for public posts, or the other people in a chat or round). This license ends when you delete
          the content or your account, except for copies other people have already received or that we must keep by law.
        </p>
        <p>Only post content you have the right to share. We may remove content that breaks these terms.</p>
      </Section>

      <Section title="Meeting other golfers">
        <p>
          GolfMe introduces golfers to each other; it doesn't organize, supervise, or insure the rounds you play. We don't run background
          checks, and we can't verify who people are, how they play, or whether they'll behave well. Reputation, reviews, and verification
          badges reflect activity on GolfMe, not a guarantee.
        </p>
        <p>
          Use good judgment: meet at the course, tell someone where you're going, and leave if you feel unsafe. Golf has real physical risks.
          You're responsible for your own safety and conduct, and you take part in rounds with other users at your own risk. If someone is
          threatening or you're in danger, contact local emergency services first, then report them to us.
        </p>
      </Section>

      <Section title="Rounds, tee times and courses">
        <p>
          Rounds are arranged between users. GolfMe doesn't process payments, and any green fees, cart fees, or bookings are between you,
          the other golfers, and the course. Course details and tee times shown in GolfMe may come from third parties or other users and can
          be wrong or out of date — always confirm with the course.
        </p>
      </Section>

      <Section title="Caddie (AI swing feedback)">
        <p>
          Caddie uses automated analysis, including AI models from third parties, to give feedback on swing videos you upload. It's for
          general practice and entertainment only — not professional instruction, medical, or fitness advice. It can be wrong. Stop if
          something hurts, and talk to a qualified coach or professional before changing how you train.
        </p>
      </Section>

      <Section title="Reviews and reputation">
        <p>
          After rounds, golfers can leave reviews that feed into reputation on GolfMe. Keep them honest and about the round. We may adjust
          or remove reviews and reputation that we believe are fake, retaliatory, or break these terms.
        </p>
      </Section>

      <Section title="Blocking, reporting and enforcement">
        <p>
          You can block other users and report users or content from their profile, a chat, a round or a post. Blocked users can't message
          you or join your rounds. We review every report and act on it — removing content, limiting features, or suspending or deleting
          accounts that break these terms or put others at risk — with or without notice, where the law allows.
        </p>
      </Section>

      <Section title="Ending your account">
        <p>
          You can stop using GolfMe at any time and delete your account from Settings, which permanently removes your profile and most of
          what's tied to it, as described in our Privacy Policy. We may also suspend or end your access if you break these terms, or if we
          change or stop offering the Service. Sections that by their nature should survive (such as content licenses already granted to
          other users, disclaimers, and limits of liability) continue to apply.
        </p>
      </Section>

      <Section title="Changes to GolfMe and to these terms">
        <p>
          GolfMe is new and changing quickly. We may add, change, or remove features at any time. We may update these terms; if a change is
          significant, we'll let you know in the app or by email before it takes effect. Continuing to use GolfMe after an update means you
          accept the new terms.
        </p>
      </Section>

      <Section title="Disclaimers">
        <p>
          GolfMe is provided "as is" and "as available". To the fullest extent the law allows, we make no warranties of any kind — express or
          implied — including that the Service will be uninterrupted, error-free, or secure, or that information in it (including other
          users' profiles, course details, and Caddie feedback) is accurate. We're not responsible for the conduct of any user, on or off the
          Service.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the fullest extent the law allows, GolfMe and its operator won't be liable for any indirect, incidental, special, consequential,
          or punitive damages, or for any loss of data, profits, or goodwill, or for personal injury or property damage arising from your
          use of the Service or from interactions with other users. Our total liability for any claim relating to the Service is limited to
          the greater of the amount you paid us in the last 12 months (GolfMe is currently free) or $100. Some places don't allow these
          limits, so they may not all apply to you.
        </p>
      </Section>

      <Section title="Indemnity">
        <p>
          If you break these terms or the law, or your content infringes someone's rights, and that leads to a claim against GolfMe, you
          agree to cover the reasonable costs of that claim, to the extent the law allows.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of the State of New York, without regard to its conflict-of-law rules. Any dispute will be
          handled in the state or federal courts located in New York County, New York, unless the law where you live gives you the right to
          bring it elsewhere. Before filing a claim, please email us so we can try to resolve it informally.
        </p>
      </Section>

      <Section title="Other terms">
        <p>
          If any part of these terms can't be enforced, the rest still applies. Not enforcing a term isn't a waiver. You can't transfer your
          rights under these terms without our consent; we may transfer ours as part of a reorganization or sale. These terms, the Privacy
          Policy, and the Community Guidelines are the whole agreement between you and GolfMe about the Service.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-fairway-700 hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
