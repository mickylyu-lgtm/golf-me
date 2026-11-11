/* eslint-disable react/only-export-components -- synthetic provider and API fixture */
// Local synthetic fixture only. Never imported by production code.
import { createContext, useContext, useState } from "react";
import { OfficialPostPermissionError, OfficialPostPublicationUncertainError } from "../src/lib/officialPost";
const golfer = { id: "qa-admin-a", name: "Synthetic Admin", photoUrl: "", avatarColor: "#285c45", avatarInitials: "SA", verification: { verifiedGolfer: false } };
export const qa = { account: "qa-admin-a", demo: false, capability: "allow", pending: [] as (() => void)[], requests: [] as string[], submissions: [] as any[], outcome: "success", posts: [] as any[], setAccount: (_id: string, _demo = false) => {}, repaint: () => {} };
(window as any).officialQa = qa;
const Context = createContext({ id: qa.account, demo: false });
export function FixtureProvider({ children }: any) {
  const [auth, setAuth] = useState({ id: qa.account, demo: false });
  const [, repaint] = useState(0);
  qa.setAccount = (id, demo = false) => { qa.account = id; qa.demo = demo; setAuth({ id, demo }); };
  qa.repaint = () => repaint(n => n + 1);
  return <Context.Provider value={auth}>{children}</Context.Provider>;
}
export function useAuth() { const auth = useContext(Context); return { isDemo: auth.demo, authUser: auth.demo ? null : { id: auth.id } }; }
export function useData() {
  const auth = useContext(Context);
  return {
    currentUser: { ...golfer, id: auth.id }, golfCalls: [],
    getGolfer: () => golfer, getGolfCall: () => null,
    isInCircle: () => false, isPostUpvoted: () => false, postUpvoteCount: () => 0,
    isPostSaved: () => false, commentsForPost: () => [], isBlocked: () => false,
    caddieAnalyses: [], createPost: async (input: any) => {
      qa.submissions.push(input);
      await new Promise(resolve => setTimeout(resolve, 120));
      if (qa.outcome === "denied") throw new OfficialPostPermissionError();
      if (qa.outcome === "uncertain") throw new OfficialPostPublicationUncertainError("qa-check-post");
      const post = { ...input, id: "qa-post-" + qa.submissions.length, authorId: auth.id, createdAt: new Date().toISOString() };
      qa.posts.push(post); qa.repaint(); return post;
    },
  };
}
export function useModeration() { return { available: false, isAdmin: false }; }
export function useRealCommunity() { return { retry: async () => {} }; }
export const supabase = {
  rpc: async (name: string) => {
    if (name !== "community_post_capabilities") throw Error("Unexpected synthetic RPC: " + name);
    const account = qa.account;
    const allowed = (qa.capability === "allow" || qa.capability === "slow") && account.startsWith("qa-admin");
    qa.requests.push(account + ":" + qa.capability);
    if (qa.capability === "slow") await new Promise<void>(resolve => qa.pending.push(resolve));
    if (qa.capability === "error") return { data: null, error: { code: "PGRST202" } };
    return { data: { version: 1, can_post_official: allowed }, error: null };
  },
};
