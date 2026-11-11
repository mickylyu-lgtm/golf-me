import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";
import { inviteDraftToSeed } from "../src/lib/inviteToPlay.ts";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const profile = read("../src/pages/GolferProfilePage.tsx");
const guidelines = read("../src/pages/CommunityGuidelines.tsx");

test("all six languages explain golf-first purpose and unwanted-contact boundaries", () => {
  const keys = Object.keys(en).filter(k => k.startsWith("guidelines."));
  assert.equal(keys.length, 10);
  for (const [locale, dict] of Object.entries({ en, es, ja, ko, zhCN, zhTW })) {
    for (const key of [...keys, "onboarding.screen1Title", "onboarding.screen1Body", "auth.welcome.headline", "auth.welcome.subheadline", "golferProfile.inviteToPlay", "community.subtitle"]) {
      const text = (dict as Record<string, string>)[key];
      assert.ok(text?.trim(), locale + ": " + key);
      if (locale !== "en") assert.notEqual(text, (en as Record<string, string>)[key], locale + " must not silently fall back to English");
    }
  }
  assert.match(en["onboarding.screen1Body"], /golf community, not a dating app/);
  assert.match(en["auth.welcome.subheadline"], /golf community, not a dating app/);
  assert.match(en["guidelines.unwantedContact"], /unwanted romantic or sexual messages/);
  assert.match(en["guidelines.unwantedContact"], /asks you to stop/);
  assert.match(en["guidelines.reporting"], /profile or in your chat/);
  assert.match(en["guidelines.reporting"], /block/);
});

test("community guidelines are localized, semantic and discoverable from the feed", () => {
  assert.match(guidelines, /useLocale/);
  assert.match(guidelines, /<ul /);
  assert.match(guidelines, /<li /);
  assert.match(guidelines, /"guidelines.unwantedContact"/);
  assert.match(guidelines, /t\("guidelines.reporting"\)/);
  assert.doesNotMatch(guidelines, /reviews every report/);
  assert.match(read("../src/pages/Community.tsx"), /navigate\("\/community\/guidelines"\)/);
});

test("round invitation is the first primary profile action with message secondary", () => {
  const invite = profile.indexOf('onClick={() => inviteToPlay(golfer)}');
  const message = profile.indexOf('onClick={() => navigate(`/messages/${golfer.id}`)}');
  assert.ok(invite >= 0 && message > invite);
  const actionGroup = profile.slice(profile.lastIndexOf("{!blocked &&", invite), message);
  assert.match(actionGroup, /messagingAllowed &&/);
  assert.match(actionGroup, /variant="outline"[^>]*icon={<MessageCircle/);
  assert.ok(profile.indexOf('t("golferProfile.playingStyle")') < profile.indexOf("{golfer.bio?.trim()"));
  assert.ok(profile.indexOf('t("golferProfile.freeTitle")') < profile.indexOf("{golfer.bio?.trim()"));
});

test("invitation stays an unsent draft and never overwrites a golfer's draft", () => {
  assert.equal(inviteDraftToSeed("", "Want to play a round?"), "Want to play a round?");
  assert.equal(inviteDraftToSeed("My existing plan", "Want to play a round?"), null);
  const hook = read("../src/lib/useInviteToPlay.ts");
  assert.match(hook, /saveChatDraft/);
  assert.doesNotMatch(hook, /sendDirectMessage|sendMessage|submitMessage/);
});
