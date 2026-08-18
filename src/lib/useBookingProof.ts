import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import { resizeImageToBlob } from "./image";

const BOOKING_PROOFS_BUCKET = "booking-proofs";
export const MAX_PROOF_FILE_BYTES = 15 * 1024 * 1024; // matches the bucket's own file_size_limit

export interface BookingProofInfo {
  proofType: "image" | "pdf";
  storagePath: string;
  bookingReference?: string;
  createdAt: string;
}

interface ProofRow {
  proof_type: "image" | "pdf";
  storage_path: string;
  booking_reference: string | null;
  created_at: string;
}

// Standalone (not a hook) upload-and-attach, so it can also be called from
// CreateGolfCall.tsx's host flow — the round doesn't exist yet while that
// wizard step is being filled in, so there's no stable golfCallId for
// useBookingProof's hook lifecycle to attach to; this gets called
// imperatively right after hostRound() returns the new round's real id.
// The useBookingProof hook's own `attach` below just wraps this.
export async function attachBookingProofDirect(authUserId: string, golfCallId: string, file: File, bookingSource: string, bookingReference: string) {
  if (file.size > MAX_PROOF_FILE_BYTES) throw new Error("That file is too large (15MB max).");
  const isPdf = file.type === "application/pdf";
  if (!isPdf && !file.type.startsWith("image/")) throw new Error("Please choose an image or PDF.");

  const proofType: "image" | "pdf" = isPdf ? "pdf" : "image";
  const blob: Blob = isPdf ? file : await resizeImageToBlob(file, 1600);
  const path = `${authUserId}/${golfCallId}/${crypto.randomUUID()}.${isPdf ? "pdf" : "jpg"}`;

  const { error: uploadError } = await supabase.storage
    .from(BOOKING_PROOFS_BUCKET)
    .upload(path, blob, { contentType: isPdf ? "application/pdf" : "image/jpeg" });
  if (uploadError) throw new Error(uploadError.message);

  const { data: oldPath, error } = await supabase.rpc("attach_booking_proof", {
    p_golf_call_id: golfCallId,
    p_storage_path: path,
    p_proof_type: proofType,
    p_booking_source: bookingSource.trim() || null,
    p_booking_reference: bookingReference.trim() || null,
  });
  if (error) {
    // Roll back the just-uploaded file so a rejected attach never leaves an
    // orphaned object behind.
    await supabase.storage.from(BOOKING_PROOFS_BUCKET).remove([path]);
    throw new Error(error.message);
  }
  const previousPath = oldPath as string | null;
  if (previousPath && previousPath !== path) {
    await supabase.storage.from(BOOKING_PROOFS_BUCKET).remove([previousPath]);
  }
}

// Host-only, per-round proof management — deliberately its own standalone
// hook (not folded into RealRoundsContext's bulk golfCalls list) since the
// booking_proofs table's own RLS already means a non-host viewer's select
// here always resolves to zero rows; there's nothing to share across the
// whole round list the way golfCalls itself is shared. No demo-mode path:
// Storage/RPCs are real-account only, same reasoning as useCoachReviews.
export function useBookingProof(golfCallId: string | undefined) {
  const { isDemo, authUser } = useAuth();
  const [proof, setProof] = useState<BookingProofInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (isDemo || !golfCallId || !authUser) {
      setProof(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("booking_proofs").select("*").eq("golf_call_id", golfCallId).maybeSingle();
    if (error) {
      console.error("Golf Me: failed to load booking proof.", error);
      setProof(null);
    } else if (data) {
      const row = data as ProofRow;
      setProof({ proofType: row.proof_type, storagePath: row.storage_path, bookingReference: row.booking_reference ?? undefined, createdAt: row.created_at });
    } else {
      setProof(null);
    }
    setLoading(false);
  }, [isDemo, golfCallId, authUser]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Private bucket — a public URL wouldn't work even if fetched. Short-lived
  // signed URL, fetched fresh each time the host actually wants to view it,
  // never cached/stored anywhere.
  const getViewUrl = useCallback(async (): Promise<string | null> => {
    if (!proof) return null;
    const { data, error } = await supabase.storage.from(BOOKING_PROOFS_BUCKET).createSignedUrl(proof.storagePath, 300);
    if (error) {
      console.error("Golf Me: failed to create a signed URL for booking proof.", error);
      return null;
    }
    return data.signedUrl;
  }, [proof]);

  const attach = useCallback(
    async (file: File, bookingSource: string, bookingReference: string) => {
      if (!authUser || !golfCallId) throw new Error("Not signed in.");
      await attachBookingProofDirect(authUser.id, golfCallId, file, bookingSource, bookingReference);
      await refetch();
    },
    [authUser, golfCallId, refetch],
  );

  const remove = useCallback(async () => {
    if (!golfCallId) return;
    const { data: path, error } = await supabase.rpc("remove_booking_proof", { p_golf_call_id: golfCallId });
    if (error) throw new Error(error.message);
    const removedPath = path as string | null;
    if (removedPath) await supabase.storage.from(BOOKING_PROOFS_BUCKET).remove([removedPath]);
    await refetch();
  }, [golfCallId, refetch]);

  return { proof, loading, attach, remove, getViewUrl, refetch };
}
