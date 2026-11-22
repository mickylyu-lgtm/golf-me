// Canonical GolfMe catalog references only. Reviewed GolfCore values, tees
// and source pages are deployed privately, never in this client module.
export const GOLFCORE_TEE_PILOT_ROW_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  "f2f2e6e8-2a64-4950-b88b-a616c82f43d9": 4, // Dyker Beach
  "7a02b0f8-2248-48b6-89b5-bae6a01c7164": 3, // Van Cortlandt
  "ff8ce37e-0a9a-4817-82dc-f8fe3d4adbd8": 5, // Marine Park
  "5b56120e-cecf-4e76-b929-fb195a0ddd13": 7, // Hendricks Field
  "53ac3cc1-3ee1-4b8d-bf67-af0b339db68e": 6, // Weequahic
  "bfc39896-41ed-45f6-9549-62f826523020": 5, // La Tourette
  "224c6ccb-9225-498d-89a4-9b65eaf39613": 4, // Silver Lake
  "dc593d4b-73c9-4c63-bf96-594d67b2a712": 4, // Douglaston
  "44598f72-c986-4aa0-bf42-fce542d79f34": 4, // Kissena
});

export function isGolfCoreTeePilotCourse(courseId: unknown): courseId is string {
  return typeof courseId === "string" && Object.prototype.hasOwnProperty.call(GOLFCORE_TEE_PILOT_ROW_COUNTS, courseId);
}
