export interface TeeRatingSet {
  course: number | null;
  slope: number | null;
  bogey: number | null;
}

export interface CourseTeeRating {
  name: string;
  group: "men" | "women";
  holes: number | null;
  overall: TeeRatingSet;
  front: TeeRatingSet;
  back: TeeRatingSet;
}

export interface CourseTeeRatings {
  tees: CourseTeeRating[];
  /** Required on nonempty real Edge responses; omitted for synthetic fixtures only. */
  source?: { url: string; reviewedOn: string };
}
