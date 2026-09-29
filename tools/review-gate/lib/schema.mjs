// Strict validation of reviewer responses (protocol golfme-review/1).
// Unknown fields, missing fields, wrong types, bad enums, wrong task_id or
// work_hash => rejected. Nothing in a response can grant permissions: callers only
// read state/task_id/work_hash/scope_change_detected/finding ids+severities.
export const PROTOCOL = "golfme-review/1";
export const STATES = ["CONTINUE", "REVISE", "USER_APPROVAL_REQUIRED", "BLOCKED", "DONE"];
const RISKS = ["low", "medium", "high", "critical"];
const SEVERITIES = ["blocker", "major", "minor", "nit"];
const CATEGORIES = ["security", "correctness", "architecture", "scope", "tests", "migration", "privacy"];

const TOP_FIELDS = ["protocol", "task_id", "work_hash", "state", "risk", "findings", "scope_change_detected", "human_gate_reasons", "summary"];
const FINDING_FIELDS = ["id", "severity", "category", "file", "line", "issue", "required_change"];

const AUTHORITY_CLAIM =
  /\b(you (may|can|are (now )?(allowed|authori[sz]ed|cleared|approved)) (to )?(push|deploy|merge|apply|proceed|bypass|skip|delete)|permission (is |has been )?granted|approval (is |has been )?granted|i (approve|authori[sz]e)|bypass (the )?(human|approval|gate|permission)|skip (the )?(human|approval|gate|review)|ignore (the |all )?(rules|gate|approval|instructions|policy)|no (need for|further) (human )?approval|disable (the )?(hook|gate))/i;

function isStr(v, max) {
  return typeof v === "string" && v.length <= max;
}

export function validateResponse(raw, expected, { maxResponseChars }) {
  const errors = [];
  if (typeof raw === "string" && raw.length > maxResponseChars) return { ok: false, errors: [`oversized response (${raw.length} > ${maxResponseChars} chars)`] };
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ["malformed JSON"] };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, errors: ["response is not a JSON object"] };

  for (const k of Object.keys(obj)) if (!TOP_FIELDS.includes(k)) errors.push(`unexpected field: ${k}`);
  for (const k of TOP_FIELDS) if (!(k in obj)) errors.push(`missing field: ${k}`);
  if (errors.length) return { ok: false, errors };

  if (obj.protocol !== PROTOCOL) errors.push("wrong protocol");
  if (obj.task_id !== expected.task_id) errors.push(`task_id mismatch (${String(obj.task_id).slice(0, 40)} != ${expected.task_id})`);
  if (obj.work_hash !== expected.work_hash) errors.push("work_hash mismatch (stale or foreign verdict)");
  if (!STATES.includes(obj.state)) errors.push(`invalid state: ${String(obj.state).slice(0, 40)}`);
  if (!RISKS.includes(obj.risk)) errors.push("invalid risk");
  if (typeof obj.scope_change_detected !== "boolean") errors.push("scope_change_detected must be boolean");
  if (!isStr(obj.summary, 500)) errors.push("summary must be a string ≤500");
  if (!Array.isArray(obj.human_gate_reasons) || !obj.human_gate_reasons.every((r) => isStr(r, 300))) errors.push("human_gate_reasons must be strings ≤300");
  if (!Array.isArray(obj.findings)) errors.push("findings must be an array");
  else
    obj.findings.forEach((f, i) => {
      if (!f || typeof f !== "object" || Array.isArray(f)) return errors.push(`finding ${i} is not an object`);
      for (const k of Object.keys(f)) if (!FINDING_FIELDS.includes(k)) errors.push(`finding ${i}: unexpected field ${k}`);
      for (const k of FINDING_FIELDS) if (!(k in f)) errors.push(`finding ${i}: missing ${k}`);
      if (!/^F\d{1,3}$/.test(String(f.id))) errors.push(`finding ${i}: bad id`);
      if (!SEVERITIES.includes(f.severity)) errors.push(`finding ${i}: bad severity`);
      if (!CATEGORIES.includes(f.category)) errors.push(`finding ${i}: bad category`);
      if (!isStr(f.file, 300)) errors.push(`finding ${i}: bad file`);
      if (!Number.isInteger(f.line) || f.line < 0) errors.push(`finding ${i}: bad line`);
      if (!isStr(f.issue, 800) || !isStr(f.required_change, 800)) errors.push(`finding ${i}: issue/required_change too long or not strings`);
    });
  if (errors.length) return { ok: false, errors };

  // Consistency rules (the reviewer cannot talk its way past these).
  let state = obj.state;
  const notes = [];
  if (state === "DONE" && obj.findings.some((f) => f.severity === "blocker" || f.severity === "major")) {
    state = "REVISE";
    notes.push("DONE downgraded to REVISE: blocker/major findings present");
  }
  if (obj.scope_change_detected && state !== "BLOCKED") {
    state = "USER_APPROVAL_REQUIRED";
    notes.push("scope change detected by reviewer");
  }
  const text = [obj.summary, ...obj.human_gate_reasons, ...obj.findings.flatMap((f) => [f.issue, f.required_change])].join("\n");
  const authorityClaim = AUTHORITY_CLAIM.test(text);
  if (authorityClaim) notes.push("reviewer_authority_claim: text claimed authority; ignored (reviewer cannot grant permissions)");

  return { ok: true, value: { ...obj, state }, originalState: obj.state, notes, authorityClaim };
}
