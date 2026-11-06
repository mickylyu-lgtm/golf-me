import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { BookingProofFileError, prepareBookingImage } from "./useBookingProof";
import type { TranslationKey } from "../i18n/locales/en";
import { bookingErrorKey, type HostBookingChoice } from "./bookingStatus";
import type { GolfCall } from "../types";

// Host-side booking status + evidence (migration 20261107150000). Every
// rule lives on the server (set_booking_status / submit_booking_evidence /
// withdraw_booking_evidence / my_booking_evidence, booking-proofs storage
// RLS); this hook only sequences the calls and keeps retries safe:
//   * one client_request_id per picked file, reused on "Try again", and the
//     object is named after it, so a retry after a lost response neither
//     uploads a second copy nor creates a second evidence version;
//   * an upload that fails, or a submit the server refuses, leaves the round
//     "not submitted" (a refused upload is deleted again);
//   * booking_version from the round row goes with every write; a stale one
//     is refused (40001) and the caller refreshes.
// Real accounts only (no demo path, like useBookingProof).

const BUCKET = "booking-proofs";

export interface MyBookingEvidence {
  evidenceId: string;
  status: "submitted" | "reviewed" | "needs_correction" | "rejected";
  storagePath: string;
  createdAt: string;
  reviewOutcome?: "reviewed" | "needs_correction" | "rejected";
  reviewReasonCode?: string;
  reviewedAt?: string;
}

export type EvidenceStep = "idle" | "preparing" | "uploading" | "saving";

export class BookingActionError extends Error {
  key: TranslationKey;
  constructor(key: TranslationKey, message?: string) {
    super(message ?? key);
    this.key = key;
  }
}

function codeOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : undefined;
}

function isAlreadyUploaded(err: { message?: string; statusCode?: string | number } | null): boolean {
  if (!err) return false;
  return String(err.statusCode ?? "") === "409" || /already exists|duplicate/i.test(err.message ?? "");
}

// Host a Round, right after host_golf_call on the server model: mark the new
// round booked (with "Booked via") and submit the picked screenshot. Each
// step can fail on its own; the round itself is already posted either way.
export async function bookAndSubmitAtCreation(authUserId: string, roundId: string, file: File, bookedVia: string): Promise<void> {
  const { data: row, error: statusErr } = await supabase.rpc("set_booking_status", {
    p_golf_call_id: roundId,
    p_status: "booked",
    p_party_size: null,
    p_booked_via: bookedVia,
    p_expected_version: 0,
  });
  if (statusErr) throw new BookingActionError(bookingErrorKey(codeOf(statusErr)), statusErr.message);
  const version = (row as { booking_version?: number } | null)?.booking_version ?? 1;
  let blob: Blob;
  try {
    blob = await prepareBookingImage(file);
  } catch (err) {
    if (err instanceof BookingProofFileError) throw new BookingActionError(err.key);
    throw err;
  }
  const requestId = crypto.randomUUID();
  const path = `${authUserId}/${roundId}/${requestId}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw new BookingActionError("golfCallDetail.bookingProofSaveError", upErr.message);
  const { error } = await supabase.rpc("submit_booking_evidence", {
    p_golf_call_id: roundId,
    p_storage_path: path,
    p_client_request_id: requestId,
    p_expected_version: version,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new BookingActionError(bookingErrorKey(codeOf(error)), error.message);
  }
}

export function useBookingEvidence(call: Pick<GolfCall, "id" | "bookingVersion">) {
  const { isDemo, authUser } = useAuth();
  const { retry: refetchRounds } = useRealRounds();
  const [mine, setMine] = useState<MyBookingEvidence | null>(null);
  const [step, setStep] = useState<EvidenceStep>("idle");
  const [saving, setSaving] = useState(false);
  // Same picked file -> same request id (and object name) across retries.
  const pending = useRef<{ file: File; requestId: string; uploaded: boolean } | null>(null);
  const roundId = call.id;
  const version = call.bookingVersion ?? 0;

  const refresh = useCallback(async () => {
    if (isDemo || !authUser) return;
    const { data, error } = await supabase.rpc("my_booking_evidence", { p_golf_call_id: roundId });
    if (error) {
      console.error("GolfMe: failed to load booking evidence.", error);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { evidence_id: string; status: MyBookingEvidence["status"]; storage_path: string; created_at: string; review_outcome: string | null; review_reason_code: string | null; reviewed_at: string | null }
      | undefined;
    setMine(
      row
        ? {
            evidenceId: row.evidence_id,
            status: row.status,
            storagePath: row.storage_path,
            createdAt: row.created_at,
            reviewOutcome: (row.review_outcome ?? undefined) as MyBookingEvidence["reviewOutcome"],
            reviewReasonCode: row.review_reason_code ?? undefined,
            reviewedAt: row.reviewed_at ?? undefined,
          }
        : null,
    );
  }, [isDemo, authUser, roundId]);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const setStatus = useCallback(
    async (status: HostBookingChoice, partySize: number | null, bookedVia: string | null) => {
      if (saving) return;
      setSaving(true);
      try {
        const { error } = await supabase.rpc("set_booking_status", {
          p_golf_call_id: roundId,
          p_status: status,
          p_party_size: status === "booked" ? partySize : null,
          p_booked_via: status === "booked" ? bookedVia : null,
          p_expected_version: version,
        });
        if (error) throw new BookingActionError(bookingErrorKey(codeOf(error)), error.message);
        await refetchRounds();
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [saving, roundId, version, refetchRounds, refresh],
  );

  const submit = useCallback(
    async (file: File) => {
      if (!authUser || step !== "idle") return;
      if (!pending.current || pending.current.file !== file) {
        pending.current = { file, requestId: crypto.randomUUID(), uploaded: false };
      }
      const job = pending.current;
      const path = `${authUser.id}/${roundId}/${job.requestId}.jpg`;
      try {
        if (!job.uploaded) {
          setStep("preparing");
          const blob = await prepareBookingImage(file);
          setStep("uploading");
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (upErr && !isAlreadyUploaded(upErr as { message?: string; statusCode?: string | number })) {
            throw new BookingActionError("golfCallDetail.bookingProofSaveError", upErr.message);
          }
          job.uploaded = true;
        }
        setStep("saving");
        const { data, error } = await supabase.rpc("submit_booking_evidence", {
          p_golf_call_id: roundId,
          p_storage_path: path,
          p_client_request_id: job.requestId,
          p_expected_version: version,
        });
        if (error) {
          const code = codeOf(error);
          // Refused for good (not a dropped connection): remove the upload
          // and start fresh next time.
          if (code === "22023" || code === "42501" || code === "40001") {
            await supabase.storage.from(BUCKET).remove([path]);
            pending.current = null;
          }
          throw new BookingActionError(bookingErrorKey(code), error.message);
        }
        pending.current = null;
        const superseded = (Array.isArray(data) ? data[0] : data)?.superseded_path as string | null | undefined;
        if (superseded) await supabase.storage.from(BUCKET).remove([superseded]);
        await refetchRounds();
        await refresh();
      } catch (err) {
        if (err instanceof BookingProofFileError) {
          pending.current = null;
          throw new BookingActionError(err.key);
        }
        throw err;
      } finally {
        setStep("idle");
      }
    },
    [authUser, step, roundId, version, refetchRounds, refresh],
  );

  const withdraw = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("withdraw_booking_evidence", { p_golf_call_id: roundId });
      if (error) throw new BookingActionError(bookingErrorKey(codeOf(error)), error.message);
      const path = data as string | null;
      if (path) await supabase.storage.from(BUCKET).remove([path]);
      await refetchRounds();
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [saving, roundId, refetchRounds, refresh]);

  // The host's own file, through a short-lived signed URL made on demand
  // (private bucket; never stored).
  const viewUrl = useCallback(async (): Promise<string | null> => {
    if (!mine) return null;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(mine.storagePath, 60);
    if (error) return null;
    return data.signedUrl;
  }, [mine]);

  return { mine, step, saving, setStatus, submit, withdraw, viewUrl, refresh };
}
