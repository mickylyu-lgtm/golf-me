import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, MapPin } from "lucide-react";
import type { GolfCall } from "../../types";
import { useData } from "../../context/DataContext";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../i18n/LocaleContext";
import { Avatar } from "../ui/Avatar";
import { courseTileSource } from "../../lib/courseImagery";
import { FittedSatelliteTiles } from "../courses/SatelliteTiles";
import { SatelliteAttribution } from "../courses/CourseThumb";
import { POINT_THUMB_ZOOM } from "../../../supabase/functions/_shared/courseBounds.ts";
import { GenericCourseIllustration } from "../courses/CourseHero";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";
import { matchHandpickedCourse } from "../../lib/handpickedCourses";
import { bookingStatusView } from "../../lib/bookingStatus";
import { formatDate, formatMoney } from "../../lib/format";
import { roundedMiles } from "../../lib/geo";
import { RoundShareButton } from "./RoundShareButton";

// Home discovery only: View round preserves the existing detail/confirmation
// flow. No joining, booking, location inference or new image API requests.
export function RoundStripCard({ call }: { call: GolfCall }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { currentUser, getGolfer } = useData();
  const { isDemo } = useAuth();
  const host = getGolfer(call.hostId);
  const course = matchHandpickedCourse(call.course);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const photo = course?.roundPhoto;
  const imageUrl = [photo?.url, course?.heroImageUrl].find((url) => url && !failedImages.includes(url));
  const showImage = Boolean(imageUrl);
  const showingPhoto = Boolean(photo && imageUrl === photo.url);
  const imageCredit = showingPhoto ? photo!.credit : course?.heroImageCredit;
  // Only stored public course coordinates, never viewer/host location or a
  // guessed geocode. Existing tile component retains lazy loading and budget.
  const lat = call.courseLat;
  const lng = call.courseLng;
  const hasCoords = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const tileSource = hasCoords ? courseTileSource({ lat, lng }) : null;
  const tileKey = `${tileSource?.id}:${lat}:${lng}`;
  const [failedTiles, setFailedTiles] = useState<string | null>(null);
  const showTiles = !showImage && hasCoords && tileSource !== null && failedTiles !== tileKey;
  const booking = bookingStatusView(call);
  const openSpots = Math.max(0, call.totalSpots - call.joinedGolferIds.length);
  const participants = [...new Set(call.joinedGolferIds)].filter((id) => id !== call.hostId).map(getGolfer).filter((g) => Boolean(g));
  const canShare = !isDemo && call.hostId === currentUser.id && call.status !== "completed" && call.status !== "cancelled";
  const price = Number.isFinite(call.estimatedPricePerPerson) && call.estimatedPricePerPerson >= 0 ? formatMoney(call.estimatedPricePerPerson) : null;
  return (
    <article className={`flex w-[calc(100vw-3rem)] max-w-sm shrink-0 snap-start flex-col overflow-hidden sm:w-80 ${CLICKABLE_CARD_CLASS}`}>
      <button
        type="button"
        onClick={() => navigate(`/golf-calls/${call.id}`)}
        className="flex flex-1 flex-col rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fairway-400"
      >
        <span className="relative block h-28 w-full overflow-hidden bg-fairway-50" aria-hidden="true">
          {showImage ? <img src={imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailedImages((failed) => [...failed, imageUrl!])} /> : showTiles && tileSource ? <FittedSatelliteTiles key={tileKey} source={tileSource} lat={lat!} lng={lng!} fallbackZoom={POINT_THUMB_ZOOM} onError={() => setFailedTiles(tileKey)} /> : <GenericCourseIllustration />}
        </span>
        <span className="flex w-full flex-1 flex-col gap-2 p-3.5">
          {showImage && imageCredit && <span className="text-[10px] leading-tight text-slate-500">{imageCredit}</span>}
          {booking.visible && <span className="self-start rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{t(booking.labelKey)}</span>}
          <span className="break-words text-base font-bold leading-snug text-slate-900">{call.course}</span>
          <span className="break-words text-sm font-semibold text-fairway-700">{formatDate(call.dateISO, locale, t)} · {call.timeLabel}</span>
          <span className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span className="break-words">{[call.areaLabel, call.distanceMiles !== undefined ? t("golfCallCard.miAway", { miles: roundedMiles(call.distanceMiles) }) : null, `${call.holes} ${t("host.holes").toLocaleLowerCase(locale)}`, price ? `~${price}` : null].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="flex shrink-0 -space-x-2">
              {host && <Avatar golfer={host} size="xs" showVerified={false} />}
              {participants.slice(0, 2).map((golfer) => golfer && <Avatar key={golfer.id} golfer={golfer} size="xs" showVerified={false} />)}
            </span>
            <span className="min-w-0 text-xs leading-relaxed">
              {host && <span className="block break-words text-slate-500">{call.hostId === currentUser.id ? t("golfCallCard.hostedByYou") : t("golfCallCard.hostedBy", { name: host.name })}</span>}
              <span className="block font-semibold text-fairway-700">{t(openSpots === 1 ? "golfCallCard.spotsRemainingSingular" : "golfCallCard.spotsRemainingPlural", { count: openSpots })}</span>
            </span>
          </span>
          <span className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-forest px-3 py-2 text-sm font-semibold text-white">
            {t("chatInbox.viewRound")} <ArrowRight size={14} aria-hidden />
          </span>
        </span>
      </button>
      {canShare && <div className="px-3.5 pb-3.5"><RoundShareButton call={call} /></div>}
      {showTiles && <div className="px-3.5 pb-3"><SatelliteAttribution /></div>}
      {showingPhoto && photo && <p className="px-3.5 pb-3 text-[10px] text-slate-500">
        <a href={photo.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Wikimedia Commons</a>
        {" · "}<a href={photo.licenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">CC BY-SA 4.0</a>
      </p>}
    </article>
  );
}
