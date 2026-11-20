# Auto-Match sparse options (local proposal, November 20)

Base: c6e6730 (main). No production data queries, schema changes, push or deployment.

## Behavior

The existing ladder chooses its first nonempty date/radius/preference context. Previously it returned immediately, even with just one result. Now, if there are fewer than three results, it tries softer preference bars (any overlap, then none) only inside that same date/radius. It stops relaxing at three or more results; this is a target, not a cap, so a whole matching tier remains available. No results are synthesized.

Most shared preferences still come first, followed by unchanged compatibility rank and distance. Actual preference checks, counts and match-tier thresholds are unchanged. Widening notices now correctly describe mixed stronger/weaker results in all six locales. Date/radius notices neutrally state the displayed range instead of falsely claiming there are no closer/chosen-day rounds. Existing date/radius widening behavior is not changed or expanded. Explicit advanced budget, skill, vibe and walking filters still prefilter candidates. Eligibility, blocks, discoverability, location requirements, travel context and nearby golfer selection are untouched. Saved preferences are never modified.

## Representative fixture

Today, 10 miles, five selected preferences; eligible rounds:

| Round | Distance | Shared preferences | Rank |
| --- | ---: | ---: | ---: |
| Strong | 3 mi | 3 | 80 |
| Two | 5 mi | 2 | 50 |
| One | 7 mi | 1 | 40 |
| Zero | 1 mi | 0 | 99 |
| Far | 11 mi | 2 | 50 |
| Tomorrow | 2 mi | 2 | 50 |

Before: Strong only (1 option).
After: Strong, Two, One (3 options), unchanged counts/ranks. Date and radius unchanged. Notice discloses partial matches. Zero is not needed; Far and Tomorrow remain outside this context.

With only Strong and Zero in the same context, both are shown and the notice explicitly includes no-shared-preference options. With three strong rounds, nothing is relaxed. If relaxing adds nothing, no misleading preference-widening notice appears.

## Verification and limits

24 ladder tests pass, including sparse options, strict-enough results, unknown distance, blocks, advanced budget, ordering and no input mutation. Final full check passed: TypeScript, lint, 1,744 tests passed (6 skipped, zero failures), and dummy-env production build. No UI component, animation, request or timing edits; maximum two extra in-memory filter/sort passes after the first hit, preserving memoized calculation. No physical iPhone/native or production-user flow tested. This proposal does not promise three results where eligible supply is insufficient and does not change labels to inflate match quality.
