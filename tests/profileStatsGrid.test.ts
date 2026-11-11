import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path: string)=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
test("full profile stats use a responsive grid while compact cards keep their row",()=>{
  const source=read("components/golfer/ReputationRow.tsx");
  assert.match(source,/if \(!compact\)/);
  assert.match(source,/grid-cols-2 gap-2 sm:grid-cols-3/);
  assert.match(source,/flex flex-wrap items-center/);
  assert.match(source,/!isNew &&/);
  for(const field of ["completedRounds","wouldPlayAgainPct","showUpRatePct","onTimePct","memberSince"])assert.ok(source.includes(field));
});
test("mutual summary is near identity before actions, separate from the stats grid",()=>{
  const source=read("pages/GolferProfilePage.tsx");
  assert.equal((source.match(/<ProfileMutualSummary /g)??[]).length,1);
  assert.ok(source.indexOf("<ProfileMutualSummary ")<source.indexOf("<FollowControl "));
  assert.ok(source.indexOf("<ProfileMutualSummary ")<source.indexOf("<ReputationRow "));
  assert.match(source,/followerStat=\{!isBlockedEitherWay\(golfer.id\)/);
});
test("own summary tiles retain rounds, handicap and the existing follower control",()=>{
  const source=read("pages/Profile.tsx");
  assert.match(source,/data-testid="own-profile-stats-grid"/);
  assert.match(source,/label=\{t\("profile.handicap"\)\}/);
  assert.match(source,/<ProfileFollowers profileId=\{currentUser.id\} layout="stat"/);
});
test("grid presentation never substitutes a count for blocked or unknown followers",()=>{
  const source=read("components/profile/ProfileFollowers.tsx");
  assert.match(source,/permitted \? <strong/);
  assert.match(source,/value === undefined \? "–" : value.total/);
  assert.doesNotMatch(source,/<LockKeyhole/);
  assert.match(source,/currentUser.id !== profileId && !isBlockedEitherWay\(profileId\)/);
});
test("new stat labels exist in all six locales",()=>{
  for(const locale of ["en","es","ja","ko","zh-CN","zh-TW"]){
    const source=read("i18n/locales/"+locale+".ts");
    for(const key of ["completedRounds","wouldPlayAgain","showUpRate","onTime","membership"])assert.ok(source.includes('"profileStats.'+key+'"'),locale+":"+key);
  }
});

test("mutuals are prominent before accepted follow, compact after, with no fabricated loading count",()=>{
  const source=read("components/profile/ProfileFollowers.tsx");
  const summary=source.slice(source.indexOf("export function ProfileMutualSummary"),source.indexOf("function FollowersSheet"));
  assert.match(summary,/const compact = isFollowing\(profileId\)/);
  assert.match(summary,/data-presentation=\{compact \? "compact" : "prominent"\}/);
  assert.match(summary,/if \(!permitted \|\| value === undefined \|\| value.mutualTotal < 1\) return null/);
  assert.match(summary,/currentUser.id !== profileId && !isBlockedEitherWay\(profileId\)/);
  assert.match(summary,/compact \? "sr-only"/);
  assert.doesNotMatch(summary,/getFollowState|state === "pending"|mutualTotal \?\? 0/);
});
