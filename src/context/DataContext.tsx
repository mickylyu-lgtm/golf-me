import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AppData,
  ChatMessage,
  CircleConnection,
  GolfCall,
  GolferProfile,
  JoinMode,
  Report,
  ReportCategory,
  Review,
  SkillFilter,
  GolfVibe,
  WalkOrCart,
} from "../types";
import { generateId } from "../lib/id";
import { loadData, saveData, resetToSeedData } from "../lib/storage";

export interface CreateGolfCallInput {
  course: string;
  areaLabel: string;
  distanceMiles: number;
  dateISO: string;
  timeLabel: string;
  estimatedPricePerPerson: number;
  totalSpots: number;
  joinMode: JoinMode;
  skillLevel: SkillFilter;
  vibe: GolfVibe;
  walkOrCart: WalkOrCart;
  notes?: string;
  // Friends already confirmed for the round when hosting via "Fill My
  // Foursome" — added to the roster alongside the host at creation time.
  additionalJoinedGolferIds?: string[];
}

export interface ReviewInput {
  showedUp: boolean;
  onTime: boolean;
  respectful: boolean;
  goodPace: boolean;
  wouldPlayAgain: boolean;
}

interface DataContextValue {
  data: AppData;
  isLoading: boolean;
  currentUser: GolferProfile;
  golfers: GolferProfile[];
  golfCalls: GolfCall[];
  messages: ChatMessage[];
  reviews: Review[];
  reports: Report[];

  getGolfer: (id: string) => GolferProfile | undefined;
  getGolfCall: (id: string) => GolfCall | undefined;
  messagesForCall: (callId: string) => ChatMessage[];
  visibleGolfers: (excludeSelf?: boolean) => GolferProfile[];

  switchCurrentUser: (id: string) => void;
  updateCurrentUserProfile: (patch: Partial<GolferProfile>) => void;
  setPhoneVerified: (value: boolean) => void;
  setEmailVerified: (value: boolean) => void;
  requestVerifiedGolfer: () => void;

  createGolfCall: (input: CreateGolfCallInput) => GolfCall;
  cancelGolfCall: (callId: string) => void;
  joinGolfCall: (callId: string) => void;
  cancelJoinRequest: (callId: string) => void;
  leaveGolfCall: (callId: string) => void;
  approveRequest: (callId: string, golferId: string) => void;
  declineRequest: (callId: string, golferId: string) => void;

  sendMessage: (callId: string, text: string) => void;

  hasReviewed: (callId: string, revieweeId: string) => boolean;
  submitReview: (callId: string, revieweeId: string, input: ReviewInput) => void;

  reportUser: (reportedId: string, category: ReportCategory, details: string, context: Report["context"], golfCallId?: string) => void;
  blockUser: (blockedId: string) => void;
  unblockUser: (blockedId: string) => void;
  isBlocked: (id: string) => boolean;
  blockedIds: string[];

  circleGolfers: GolferProfile[];
  isInCircle: (golferId: string) => boolean;
  addToCircle: (memberId: string) => void;
  hasPlayedWith: (golferId: string) => boolean;

  resetDemoData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) saveData(data);
  }, [data, isLoading]);

  const currentUser = useMemo(
    () => data.golfers.find((g) => g.id === data.currentUserId) ?? data.golfers[0],
    [data.golfers, data.currentUserId],
  );

  const getGolfer = useCallback((id: string) => data.golfers.find((g) => g.id === id), [data.golfers]);
  const getGolfCall = useCallback((id: string) => data.golfCalls.find((c) => c.id === id), [data.golfCalls]);
  const messagesForCall = useCallback(
    (callId: string) => data.messages.filter((m) => m.golfCallId === callId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.messages],
  );

  const blockedIds = useMemo(
    () => data.blocks.filter((b) => b.blockerId === currentUser.id).map((b) => b.blockedId),
    [data.blocks, currentUser.id],
  );

  const isBlocked = useCallback((id: string) => blockedIds.includes(id), [blockedIds]);

  const visibleGolfers = useCallback(
    (excludeSelf = true) =>
      data.golfers.filter((g) => (excludeSelf ? g.id !== currentUser.id : true) && !blockedIds.includes(g.id)),
    [data.golfers, currentUser.id, blockedIds],
  );

  const addSystemMessage = useCallback((callId: string, text: string) => {
    setData((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: generateId("msg"), golfCallId: callId, senderId: "system", text, createdAt: new Date().toISOString(), system: true },
      ],
    }));
  }, []);

  const switchCurrentUser = useCallback((id: string) => {
    setData((prev) => ({ ...prev, currentUserId: id }));
  }, []);

  const updateCurrentUserProfile = useCallback((patch: Partial<GolferProfile>) => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) => (g.id === prev.currentUserId ? { ...g, ...patch } : g)),
    }));
  }, []);

  const setPhoneVerified = useCallback((value: boolean) => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) =>
        g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, phoneVerified: value } } : g,
      ),
    }));
  }, []);

  const setEmailVerified = useCallback((value: boolean) => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) =>
        g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, emailVerified: value } } : g,
      ),
    }));
  }, []);

  const requestVerifiedGolfer = useCallback(() => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) =>
        g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, verifiedGolfer: true } } : g,
      ),
    }));
  }, []);

  const createGolfCall = useCallback(
    (input: CreateGolfCallInput): GolfCall => {
      const joinedGolferIds = [data.currentUserId, ...(input.additionalJoinedGolferIds ?? [])];
      const call: GolfCall = {
        id: generateId("call"),
        hostId: data.currentUserId,
        course: input.course,
        areaLabel: input.areaLabel,
        distanceMiles: input.distanceMiles,
        dateISO: input.dateISO,
        timeLabel: input.timeLabel,
        estimatedPricePerPerson: input.estimatedPricePerPerson,
        totalSpots: input.totalSpots,
        joinedGolferIds,
        pendingRequestIds: [],
        joinMode: input.joinMode,
        skillLevel: input.skillLevel,
        vibe: input.vibe,
        walkOrCart: input.walkOrCart,
        status: joinedGolferIds.length >= input.totalSpots ? "full" : "open",
        notes: input.notes,
        createdAt: new Date().toISOString(),
      };
      setData((prev) => ({ ...prev, golfCalls: [call, ...prev.golfCalls] }));
      return call;
    },
    [data.currentUserId],
  );

  const cancelGolfCall = useCallback(
    (callId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) => (c.id === callId ? { ...c, status: "cancelled" } : c)),
      }));
      addSystemMessage(callId, "The host cancelled this Golf Call.");
    },
    [addSystemMessage],
  );

  const joinGolfCall = useCallback(
    (callId: string) => {
      const call = data.golfCalls.find((c) => c.id === callId);
      if (!call) return;
      const uid = data.currentUserId;
      if (call.joinedGolferIds.includes(uid) || call.pendingRequestIds.includes(uid)) return;

      if (call.joinMode === "instant") {
        setData((prev) => ({
          ...prev,
          golfCalls: prev.golfCalls.map((c) => {
            if (c.id !== callId) return c;
            const joined = [...c.joinedGolferIds, uid];
            return { ...c, joinedGolferIds: joined, status: joined.length >= c.totalSpots ? "full" : c.status };
          }),
        }));
        addSystemMessage(callId, `${currentUser.name} joined the round.`);
      } else {
        setData((prev) => ({
          ...prev,
          golfCalls: prev.golfCalls.map((c) =>
            c.id === callId ? { ...c, pendingRequestIds: [...c.pendingRequestIds, uid] } : c,
          ),
        }));
        addSystemMessage(callId, `${currentUser.name} requested to join. Waiting on host approval.`);
      }
    },
    [data.golfCalls, data.currentUserId, currentUser.name, addSystemMessage],
  );

  const cancelJoinRequest = useCallback(
    (callId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) =>
          c.id === callId ? { ...c, pendingRequestIds: c.pendingRequestIds.filter((id) => id !== prev.currentUserId) } : c,
        ),
      }));
    },
    [],
  );

  const leaveGolfCall = useCallback(
    (callId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) =>
          c.id === callId
            ? { ...c, joinedGolferIds: c.joinedGolferIds.filter((id) => id !== prev.currentUserId), status: "open" }
            : c,
        ),
      }));
      addSystemMessage(callId, `${currentUser.name} left the round.`);
    },
    [addSystemMessage, currentUser.name],
  );

  const approveRequest = useCallback(
    (callId: string, golferId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) => {
          if (c.id !== callId) return c;
          const joined = [...c.joinedGolferIds, golferId];
          return {
            ...c,
            joinedGolferIds: joined,
            pendingRequestIds: c.pendingRequestIds.filter((id) => id !== golferId),
            status: joined.length >= c.totalSpots ? "full" : c.status,
          };
        }),
      }));
      const golfer = getGolfer(golferId);
      addSystemMessage(callId, `${golfer?.name ?? "A golfer"} was approved to join the round.`);
    },
    [addSystemMessage, getGolfer],
  );

  const declineRequest = useCallback((callId: string, golferId: string) => {
    setData((prev) => ({
      ...prev,
      golfCalls: prev.golfCalls.map((c) =>
        c.id === callId ? { ...c, pendingRequestIds: c.pendingRequestIds.filter((id) => id !== golferId) } : c,
      ),
    }));
  }, []);

  const sendMessage = useCallback(
    (callId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setData((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: generateId("msg"),
            golfCallId: callId,
            senderId: prev.currentUserId,
            text: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    [],
  );

  const hasReviewed = useCallback(
    (callId: string, revieweeId: string) =>
      data.reviews.some((r) => r.golfCallId === callId && r.revieweeId === revieweeId && r.reviewerId === data.currentUserId),
    [data.reviews, data.currentUserId],
  );

  const submitReview = useCallback(
    (callId: string, revieweeId: string, input: ReviewInput) => {
      setData((prev) => {
        const already = prev.reviews.some(
          (r) => r.golfCallId === callId && r.revieweeId === revieweeId && r.reviewerId === prev.currentUserId,
        );
        if (already) return prev;
        const review: Review = {
          id: generateId("rev"),
          golfCallId: callId,
          reviewerId: prev.currentUserId,
          revieweeId,
          ...input,
          createdAt: new Date().toISOString(),
        };
        return { ...prev, reviews: [...prev.reviews, review] };
      });
    },
    [],
  );

  const reportUser = useCallback(
    (reportedId: string, category: ReportCategory, details: string, context: Report["context"], golfCallId?: string) => {
      setData((prev) => ({
        ...prev,
        reports: [
          ...prev.reports,
          {
            id: generateId("rpt"),
            reporterId: prev.currentUserId,
            reportedId,
            category,
            details,
            context,
            golfCallId,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    [],
  );

  const blockUser = useCallback((blockedId: string) => {
    setData((prev) => ({
      ...prev,
      blocks: [...prev.blocks, { blockerId: prev.currentUserId, blockedId, createdAt: new Date().toISOString() }],
    }));
  }, []);

  const unblockUser = useCallback((blockedId: string) => {
    setData((prev) => ({
      ...prev,
      blocks: prev.blocks.filter((b) => !(b.blockerId === prev.currentUserId && b.blockedId === blockedId)),
    }));
  }, []);

  const hasPlayedWith = useCallback(
    (golferId: string) =>
      data.golfCalls.some(
        (c) => c.status === "completed" && c.joinedGolferIds.includes(data.currentUserId) && c.joinedGolferIds.includes(golferId),
      ),
    [data.golfCalls, data.currentUserId],
  );

  const circleGolfers = useMemo(
    () =>
      data.circle
        .filter((c) => c.ownerId === currentUser.id)
        .map((c) => data.golfers.find((g) => g.id === c.memberId))
        .filter((g): g is GolferProfile => Boolean(g)),
    [data.circle, data.golfers, currentUser.id],
  );

  const isInCircle = useCallback(
    (golferId: string) => data.circle.some((c) => c.ownerId === currentUser.id && c.memberId === golferId),
    [data.circle, currentUser.id],
  );

  const addToCircle = useCallback((memberId: string) => {
    setData((prev) => {
      const already = prev.circle.some((c) => c.ownerId === prev.currentUserId && c.memberId === memberId);
      if (already) return prev;
      const connection: CircleConnection = {
        id: generateId("circ"),
        ownerId: prev.currentUserId,
        memberId,
        createdAt: new Date().toISOString(),
      };
      return { ...prev, circle: [...prev.circle, connection] };
    });
  }, []);

  const resetDemoData = useCallback(() => {
    setData(resetToSeedData());
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      data,
      isLoading,
      currentUser,
      golfers: data.golfers,
      golfCalls: data.golfCalls,
      messages: data.messages,
      reviews: data.reviews,
      reports: data.reports,
      getGolfer,
      getGolfCall,
      messagesForCall,
      visibleGolfers,
      switchCurrentUser,
      updateCurrentUserProfile,
      setPhoneVerified,
      setEmailVerified,
      requestVerifiedGolfer,
      createGolfCall,
      cancelGolfCall,
      joinGolfCall,
      cancelJoinRequest,
      leaveGolfCall,
      approveRequest,
      declineRequest,
      sendMessage,
      hasReviewed,
      submitReview,
      reportUser,
      blockUser,
      unblockUser,
      isBlocked,
      blockedIds,
      circleGolfers,
      isInCircle,
      addToCircle,
      hasPlayedWith,
      resetDemoData,
    }),
    [
      data,
      isLoading,
      currentUser,
      getGolfer,
      getGolfCall,
      messagesForCall,
      visibleGolfers,
      switchCurrentUser,
      updateCurrentUserProfile,
      setPhoneVerified,
      setEmailVerified,
      requestVerifiedGolfer,
      createGolfCall,
      cancelGolfCall,
      joinGolfCall,
      cancelJoinRequest,
      leaveGolfCall,
      approveRequest,
      declineRequest,
      sendMessage,
      hasReviewed,
      submitReview,
      reportUser,
      blockUser,
      unblockUser,
      isBlocked,
      blockedIds,
      circleGolfers,
      isInCircle,
      addToCircle,
      hasPlayedWith,
      resetDemoData,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
