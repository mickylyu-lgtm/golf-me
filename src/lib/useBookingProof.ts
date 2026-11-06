import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import { resizeImageToBlob } from "./image";
import type { TranslationKey } from "../i18n/locales/en";

const BOOKING_PROOFS_BUCKET = "booking-proofs";
// Micky's decision (2026-11-05): screenshots/photos only, re-encoded on the
// device (JPEG, 1600 px, which also drops EXIF/location), at most 5 MB as
// uploaded. No PDFs. A raw pick far over that is refused before decoding.
export const MAX_PROOF_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PROOF_PICK_BYTES = 40 * 1024 * 1024;

// A file the host picked that can't be used; `key` is the message to show.
export class BookingProofFileError extends Error {
  key: TranslationKey;
  constructor(key: TranslationKey) {
    super(key);
    this.key = key;
  }
}

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
// No booking reference / confirmation number is collected any more (Micky,
// 2026-11-05): p_booking_reference is always null.
// The one image pipeline for booking evidence (legacy attach and the
// Stage 2 submit): images only, re-encoded to JPEG at 1600 px on the device
// (drops EXIF/location metadata), at most 5 MB as uploaded.
export async function prepareBookingImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new BookingProofFileError("booking.errorNotImage");
  if (file.size > MAX_PROOF_PICK_BYTES) throw new BookingProofFileError("booking.errorTooLarge");
  let blob: Blob;
  try {
    blob = await resizeImageToBlob(file, 1600);
  } catch {
    throw new BookingProofFileError("booking.errorNotImage");
  }
  if (blob.size > MAX_PROOF_UPLOAD_BYTES) throw new BookingProofFileError("booking.errorTooLarge");
  return blob;
}

export async function attachBookingProofDirect(authUserId: string, golfCallId: string, file: File, bookingSource: string) {
  const blob = await prepareBookingImage(file);
  const path = `${authUserId}/${golfCallId}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabase.storage.from(BOOKING_PROOFS_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (uploadError) throw new Error(uploadError.message);

  const { data: oldPath, error } = await supabase.rpc("attach_booking_proof", {
    p_golf_call_id: golfCallId,
    p_storage_path: path,
    p_proof_type: "image",
    p_booking_source: bookingSource.trim() || null,
    p_booking_reference: null,
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
      console.error("GolfMe: failed to load booking proof.", error);
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
      console.error("GolfMe: failed to create a signed URL for booking proof.", error);
      return null;
    }
    return data.signedUrl;
  }, [proof]);

  const attach = useCallback(
    async (file: File, bookingSource: string) => {
      if (!authUser || !golfCallId) throw new Error("Not signed in.");
      await attachBookingProofDirect(authUser.id, golfCallId, file, bookingSource);
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
