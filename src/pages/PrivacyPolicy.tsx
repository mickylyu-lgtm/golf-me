import { useNavigate } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { goBack } from "../lib/goBack";

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
const LAST_UPDATED = "November 6, 2026";
const CONTACT_EMAIL = "support@golfme.app";

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
        onClick={() => goBack(navigate)}
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
          the rounds, messages (including photos and voice messages) and posts you're part of, and your location only when you choose to
          share it. We don't sell your data, we
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
          Your email address and sign-in details. You can sign in with Apple, with Google, or with a 6-digit code we email you; a few
          accounts, such as the demo account we give Apple's app reviewers, sign in with an email and password. If you sign in with Google, we receive your name, email and profile picture from Google —
          nothing else. Your Google picture is suggested as your GolfMe profile photo when you set up your profile; you can remove or
          change it then or at any time on your profile. If you sign in with Apple, we receive the name and email you choose to share; if you choose Hide My Email, we only
          see Apple's private relay address.
        </Item>
        <Item label="Profile">
          Your name, username, profile photo, age range, gender, short bio, handicap and skill level, language, home playing area, favorite
          courses, and your match preferences (availability, budget, travel radius, walking or cart, pace, group type, game format, and any
          age, gender or handicap preferences you set).
        </Item>
        <Item label="Location">
          If you allow it, your device location is used to show nearby courses, rounds and golfers. It's rounded on your device to about
          1 km (under a mile) before it's sent or saved, so we only ever store an approximate playing area — never your exact position —
          and you can enter an area manually instead. When you search for courses or places, that approximate location and what you type
          are sent to our course-search provider. When you look at the course map or a course page, the map area on screen is used to load
          map images (see "Course maps and imagery" below).
        </Item>
        <Item label="Content you create">
          Golf Calls you host or join, direct messages and round group chats (including photos and voice messages you send in them),
          Community posts, comments, likes, saved and hidden posts, photos and videos you upload, follows, reviews you leave about golfers
          you've played with (including optional private notes), reports you file, blocks, booking-proof screenshots you attach to a round,
          and swing reviews if you're a coach reviewer.
        </Item>
        <Item label="Chat photos and voice messages">
          Before a photo you send in a direct message or round chat is uploaded, your device re-encodes it, which removes hidden metadata
          such as the location where it was taken (GPS) and other camera (EXIF) data. Voice messages are recorded on your device. Both are
          stored privately and can only be opened by the people in that chat. If you unsend one (within 5 minutes of sending), it's removed
          from the chat and its file is deleted; we don't keep a copy. If the app can't delete the file right away, our server deletes it
          automatically within about a day. Photos and voice messages aren't automatically scanned or moderated.
          If someone reports a chat, GolfMe admins can view the photos and voice messages the reported person sent in that chat so they can
          review the report.
        </Item>
        <Item label="Caddie swing videos">
          Swing videos you upload to Caddie and the AI-generated analysis produced from them (score, feedback and body-position data).
          Caddie videos are private to you unless you choose to share one to the Community. Your video is analyzed by our own server, which
          sends still frames from the clip to Roboflow to detect your body position and the clip itself to Google Gemini to write your
          feedback (see "Service providers" below). If an analysis fails, we keep a technical record of what went wrong (numbers only, such
          as how many frames showed a usable body; never images or video) so we can make Caddie more reliable, and we keep a record that
          each analysis ran so daily limits work, even after you delete that analysis.
        </Item>
        <Item label="Activity and reputation">
          Rounds you've completed and the ratings other golfers give you (show-up, on-time, pace, respect, would play again), which we
          combine into your GolfMe reputation.
        </Item>
        <Item label="Notifications">
          If you turn on push notifications, a device token from Apple that lets us send notifications to your phone, and your
          notification settings. We send push notifications for messages, people joining your rounds and changes to rounds you've joined,
          finished Caddie analyses, likes and comments on your posts, replies to your comments, and, if you switch them on in Settings, new
          rounds near you and posts from your Golf Circle.
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
          improve the app. We use your email to send sign-in codes and account notices — never marketing without your consent.
        </p>
      </Section>

      <Section title="Who can see your information">
        <p>
          GolfMe is a social app. Other signed-in GolfMe members can see your profile (including the profile details and approximate
          playing area listed above, your reputation and whether you have the Verified Golfer badge), your posts and comments, who you follow, and the Golf Calls you host or have
          joined. Direct messages and round group chats, including their photos and voice messages, are visible only to the people in
          them (GolfMe admins can view a reported chat's photos and voice messages, as described above). Reviews you write, their private notes,
          your reports and your booking proofs are not shown to other members (GolfMe admins can see reports and booking proofs to keep
          the community safe). Photos and videos you post to the Community can be viewed by anyone who has their link.
        </p>
        <p>
          Push notifications for messages show the sender's name and a short preview of the message on your lock screen (for a photo, its
          caption if it has one; the photo itself and voice messages are never shown). Comment notifications show the commenter's name and a short preview of the comment, and
          like notifications show who liked your post. You can hide previews in your iPhone's notification settings.
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
            <span className="font-semibold text-slate-800">Vercel</span> — hosts the GolfMe website and app, runs the part of our server
            that prepares Caddie videos for analysis (cutting the section you chose and extracting still frames), and provides the
            page-view analytics described above.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Apple Push Notification service</span> — delivers push notifications to your
            iPhone, including the sender's or commenter's name and the message or comment preview.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Google (sign-in)</span> — only if you choose "Continue with Google".
          </li>
          <li>
            <span className="font-semibold text-slate-800">Apple (sign-in)</span> — only if you choose "Sign in with Apple". When you
            delete your GolfMe account, we also revoke GolfMe's access to your Apple ID.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Google Gemini API</span> — used only if you use Caddie: our server temporarily
            uploads your swing video to generate your written feedback (we ask Google to delete it right after the analysis), and if you translate
            feedback into another language, that text is sent to be translated.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Roboflow</span> — used only if you use Caddie: our server sends still frames
            from your swing video to detect your body position for the analysis.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Geoapify</span> — powers course and place search; your approximate search
            location and what you type are sent to find nearby courses and places.
          </li>
          <li>
            <span className="font-semibold text-slate-800">GolfCourseAPI</span> — provides course details; only course names are sent,
            never information about you.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Resend</span> — sends our emails, such as sign-in codes and waitlist notices.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Course maps and imagery</span> — when you view the course map or a course
            page, your device loads map tiles from OpenFreeMap (built on OpenStreetMap data), aerial imagery from the U.S. Geological Survey
            (USGS, including NAIP aerial photos) and course photos from Wikimedia Commons. As with any image a website loads, these
            providers see your device's IP address and the map area being shown; no account information is sent. Our server also looks up
            course outlines and hole layouts from OpenStreetMap's Overpass API and course photos from Wikimedia, sending only the course's
            name and location, never information about you (with the demo account, or if our server can't answer, your device may ask the
            Overpass API directly). If enabled, course photos can also come from Google Places: our server sends only the course's name and
            location, and your device then loads the photo from Google.
          </li>
        </ul>
        <p>We may also disclose information if the law requires it, or to protect the safety of our members or others.</p>
      </Section>

      <Section title="Your choices">
        <p>
          You can edit your profile and remove most of your content directly in the app, change your location or enter it manually, and
          turn notifications off. You can delete your account entirely from Me → Settings → Account — this permanently deletes your
          profile and virtually everything tied to it (posts, comments, messages including the photos and voice messages you sent, Golf
          Call history, reviews, follows, Caddie videos, analyses and their technical records, booking proofs, device tokens). A small amount of information may be kept in anonymized form for safety records — for example,
          a report that named you stays on file with your identity removed from it. To ask about, correct or delete your data (including
          a waitlist entry), email us at the address above.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your information for as long as your account is active, and delete it when you delete your account (except the
          anonymized safety records described above). When you unsend a text message, it disappears from the chat for everyone, but we
          keep a hidden copy of its text, which only GolfMe's operator can access, for safety. The copy is deleted automatically 90 days
          after the message was unsent, unless a report about that message, or about its sender in that chat, is still open; then it is
          kept until the report is closed and deleted automatically after that. Unsent photos and voice messages are deleted, with no copy
          kept (if the app can't delete the file right away, our server deletes it automatically within about a day). For swing videos
          sent to Google Gemini for Caddie, we ask Google to delete the video right after the analysis. Waitlist entries are kept until you ask us to remove them. Technical logs
          kept by our providers are deleted on their standard schedules.
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
