import { useState } from 'react';
import { useBestCoursePhoto } from '../../lib/courseImageryClient';
import { aerialCredit, courseTileSource } from '../../lib/courseImagery';
import { roundBannerCourseId, roundBannerSatellite } from '../../lib/roundBanner';
import { useLocale } from '../../i18n/LocaleContext';
import { GenericCourseIllustration } from './CourseHero';
import { FittedSatelliteTiles } from './SatelliteTiles';
import { POINT_HERO_ZOOM } from '../../../supabase/functions/_shared/courseBounds';

/** Keyed by venue identity: a late old photo cannot leak into another round.
 * No drone asset exists in the current catalog. Existing verified photo
 * service leads; only its validated course outline permits satellite. */
export function RoundVenueBanner({ courseId, name }: { courseId?: string; name: string }) {
  const id = roundBannerCourseId(courseId);
  return <VenueBanner key={`${id ?? 'unknown'}:${name}`} courseId={id} name={name} />;
}
function VenueBanner({ courseId, name }: { courseId?: string; name: string }) {
  const { t } = useLocale();
  // Deliberately omit lat/lng: prevents browser name/location fallback if
  // the server has no verified result. No lookup at all for typed venues.
  const { photo, settled, bounds } = useBestCoursePhoto(courseId ? { id: courseId, name } : null, 'hero');
  const [photoFailed, setPhotoFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const point = roundBannerSatellite(courseId, bounds);
  const source = point ? courseTileSource(point) : null;
  const showPhoto = !photoFailed && photo;
  const showSatellite = !tilesFailed && settled && !showPhoto && point && source;
  return <figure className="overflow-hidden rounded-2xl border border-slate-100 bg-fairway-50" data-testid="round-venue-banner">
    <div className="relative h-32 w-full sm:h-40">
      {showPhoto ? <img src={photo.url} alt={name} decoding="async" className="h-full w-full object-cover" onError={() => setPhotoFailed(true)} />
        : showSatellite ? <FittedSatelliteTiles source={source} lat={point.lat} lng={point.lng} bounds={point.bounds} fallbackZoom={POINT_HERO_ZOOM} onError={() => setTilesFailed(true)} />
          : <GenericCourseIllustration />}
      {(showPhoto || showSatellite) && <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700">{t(showPhoto ? 'courseImage.photo' : 'courseImage.satellite')}</span>}
    </div>
    {showPhoto && <figcaption className="bg-white px-3 py-1 text-right text-[10px] text-slate-500">
      {photo.source === 'google' ? <>{photo.authors?.map((author, index) => <span key={`${author.name}:${index}`}>{author.uri ? <a href={author.uri} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}{' · '}</span>)}<a href={photo.mapsUri ?? 'https://maps.google.com/'} target="_blank" rel="noopener noreferrer">Google Maps</a></>
        : <a href={photo.pageUrl} target="_blank" rel="noopener noreferrer">{photo.credit ?? 'Wikimedia Commons'}</a>}
    </figcaption>}
    {showSatellite && <figcaption className="bg-white px-3 py-1 text-right text-[10px] text-slate-500">{aerialCredit(source)}</figcaption>}
  </figure>;
}
