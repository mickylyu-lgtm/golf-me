# GolfMe Launch Marketing Plan (NYC)

**Created:** 2026-10-07, while the TestFlight build is in Apple review. Track status in `LAUNCH_CHECKLIST.md` (sections 11–13); this file is the plan.

## The pitch
**"Find your foursome in NYC."** Host or join real rounds with golfers near you, chat, and get AI swing feedback from Caddie.

**Launch hook: Founding Golfers.** The first 250 NYC golfers each get a permanent, numbered Founding Golfer badge (#1–#250). A number can't be bought or reassigned and is never reused. Lines to use:
- "Be one of NYC's first 250 GolfMe golfers. Your number is yours forever."
- "Founding Golfer #37" on a profile is something people screenshot and share.

Why this works: the number creates urgency without a discount, it rewards people for coming early, and it gives creators and early users a reason to post.

## Phase 0: before approval (now)
Don't push hard until the app has rounds people can actually join. Nobody stays in an empty app.

**1. Founding Golfer, ready to switch on** (engineering, B):
- [ ] Fix the migrations: complete the exclusion list (the test accounts, plus a decision on both "Jordan Kim" accounts), require a confirmed email before awarding a number, have the backfill stop unless the award count is the one confirmed in advance, and raise an error on an excluded ID that doesn't exist.
- [ ] Badge on profiles (own and others'), plus "X of 250 spots left" on the landing page and in onboarding. Both run on the live web app, so they don't need a new Apple review.
- [ ] Apply the migrations (with Micky's approval) when the badge screens ship. The backfill numbers existing users by signup date.

**2. Rounds people can join** (blocker 4 in the checklist):
- [ ] At least 5 real upcoming rounds visible in Play on launch day, at different NYC public courses and simulators, on weekends and weeknights.
- [ ] Micky hosts weekly "Founders Rounds" for the first 4 weeks.

**3. Assets:**
- [ ] App Store link and QR code (once approved).
- [ ] Landing page: the pitch, the Founding counter, App Store and web buttons.
- [ ] 3 short vertical videos (15–30 s): join a round in 3 taps · Caddie swing analysis · the Founding badge reveal.
- [ ] A shareable badge card ("I'm Founding Golfer #X on GolfMe").
- [ ] A one-paragraph founder story (why Micky built it).

**4. Outreach lists** (names and contacts in `LAUNCH_CHECKLIST.md` §11–12):
- [ ] 5–10 NYC golf micro-creators. Each hosts one real round, which gives attribution per round (§12).
- [ ] NYC golf groups: subreddits, Discords, Facebook/Meetup groups, leagues.
- [ ] College golf clubs (NYU, Columbia, Fordham, CUNY).
- [ ] Simulator venues and indoor golf bars: ask about a counter card or QR code.
- [ ] Warm list: the 26 existing accounts, waitlist signups, friends who golf.

## Phase 1: launch day
- [ ] Run the technical checks in checklist §13 first (health, a clean App Store install, auth, at least 3 rounds visible).
- [ ] Email or DM the existing accounts and the waitlist: "We're live. Founding Golfer spots are open."
- [ ] Founder post on Instagram, TikTok and LinkedIn, plus the badge video.
- [ ] Creators post their round links.
- [ ] Post in the communities (follow each group's self-promo rules; lead with the free rounds, not the app).
- [ ] Reply to every new user within hours through the founder welcome chat.

## Phase 2: weeks 1–4
- Weekly: a Founders Round, a "spots left" countdown post, and a shout-out to a few Founding Golfers (only with their permission).
- Countdown pushes at 100 / 50 / 10 spots left.
- After each round, ask players to post a photo and tag GolfMe.
- Keep the creator rounds going; double down on whichever channel brings people who actually join rounds.

## What to measure (weekly)
| Metric | Why |
|---|---|
| Signups → onboarded in NYC | Top of funnel |
| Founding spots claimed (of 250) | The hook's pull |
| Rounds hosted / joined / completed | The real product signal |
| Joins per round, by creator/channel | Which outreach works |
| 7-day return rate | Whether people stick around |

Goal to calibrate after week 1: 250 Founding spots filled within about 6–8 weeks, with most of them joining at least one round.

## Risks
- **An empty marketplace** is the biggest risk. Gate the wide push on enough upcoming rounds.
- **Farming the 250 spots** with fake signups. Prevented by the confirmed-email requirement before opening, plus watching the award rate.
- **Over-promising:** don't market features that are still mocked or demo-only (see `BACKEND_STATUS.md`).
