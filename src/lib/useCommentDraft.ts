import { useLayoutEffect, useReducer, useState } from "react";
import { chatDraftVersion, loadChatDraft, observeChatDrafts, saveChatDraft } from "./chatDraft";
import { createCommentDraftSession } from "./commentDraftSession";

export function useCommentDraft(owner: string, key: string) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const [session] = useState(() => createCommentDraftSession({ load: loadChatDraft, save: saveChatDraft, changed: render, version: chatDraftVersion }));
  useLayoutEffect(() => {
    const stop = observeChatDrafts(session.refresh);
    session.open(owner, key);
    return () => { stop(); session.close(); };
  }, [session, owner, key]);
  const snapshot = session.snapshot();
  const current = snapshot.owner === owner && snapshot.key === key;
  return {
    text: current ? snapshot.text : "",
    submitting: current && snapshot.submitting,
    update: session.update,
    submit: session.submit,
  };
}
