// Model completion/compliance statements are not coaching. Keep this narrow:
// remove only whole, known boilerplate sentences, never English words or
// arbitrary "constraint" / "analysis" mentions. Shared by persistence,
// translation input/output, and old-record display; no data migration.
const STATUS_SENTENCES = [
  /^(?:all\s+)?constraints?\s*(?:(?:(?:have|has)\s+been|were|are)\s+)?(?:satisfied|met|followed|respected|complied\s+with|adhered\s+to)$/i,
  /^constraints?\s*(?:遵守|已遵守|已满足|已滿足)$/i,
  /^(?:the\s+)?analysis\s+(?:(?:has\s+been|was)\s+)?(?:completed|finished)(?:\s+successfully)?$/i,
  /^(?:已遵守(?:所有)?(?:约束|約束|限制|要求)|(?:所有)?(?:约束|約束|限制|要求)(?:均|已|已被)?(?:遵守|满足|滿足))$/u,
  /^分析(?:已)?(?:成功完成|完成成功|完成)$/u,
  /^(?:todas\s+las\s+)?restricciones\s+(?:(?:han\s+sido|fueron)\s+)?(?:cumplidas|respetadas)$/i,
  /^(?:el\s+)?análisis\s+(?:(?:ha\s+sido|fue)\s+)?(?:completado|finalizado)(?:\s+(?:correctamente|con\s+éxito))?$/i,
  /^(?:すべての)?制約(?:を|は|が)?(?:遵守しました|遵守されています|満たしました|満たされています|遵守)$/u,
  /^分析(?:が|は)?(?:正常に|無事に)?完了(?:しました|しています)?$/u,
  /^(?:모든\s*)?제약\s*조건(?:을|이|은)?\s*(?:준수했습니다|충족했습니다|충족되었습니다|준수됨)$/u,
  /^분석(?:이|은)?\s*(?:성공적으로\s*)?완료(?:되었습니다|했습니다|됨)$/u,
];

export function cleanCaddieFeedbackText(text: string): string {
  // Preserve original bytes for clean prose (including decimals, abbreviations,
  // formatting and intentional English golf terms in other languages).
  let removed = false;
  const result = text.replace(/[^.!?。！？;\n]+[.!?。！？;]*/gu, (sentence) => {
    const body = sentence.trim().replace(/[.!?。！？;]+$/u, "").trim();
    if (!STATUS_SENTENCES.some((pattern) => pattern.test(body))) return sentence;
    removed = true;
    return "";
  });
  return removed ? result.trim() : text;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function cleanFields(value: unknown, keys: string[]): unknown {
  if (!isRecord(value)) return value;
  const copy = { ...value };
  for (const key of keys) {
    if (typeof copy[key] === "string") copy[key] = cleanCaddieFeedbackText(copy[key] as string);
  }
  return copy;
}

function cleanList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.flatMap((v) => {
    if (typeof v !== "string") return [v];
    const cleaned = cleanCaddieFeedbackText(v);
    // Drop only entries that were entirely recognized boilerplate. Originally
    // empty/malformed entries remain invalid; never manufacture missing advice.
    return v.trim() !== "" && cleaned === "" ? [] : [cleaned];
  });
}

// Only known prose fields. Never touch ids, URLs, enums, language, numerical
// scores, timestamps, confidence, pose data, or arbitrary extension metadata.
export function cleanCaddieFeedback<T extends Record<string, unknown>>(input: T): T {
  if (!isRecord(input)) return input;
  const out = cleanFields(input, ["summary"]) as Record<string, unknown>;
  for (const key of ["strengths", "limitations"]) {
    if (key in out) out[key] = cleanList(out[key]);
  }
  if (Array.isArray(out.work_on)) out.work_on = out.work_on.map((w) => cleanFields(w, ["issue", "why_it_matters"]));
  if ("focus" in out) out.focus = cleanFields(out.focus, ["title", "instruction"]);
  if (isRecord(out.drill)) {
    out.drill = cleanFields(out.drill, ["name"]);
    const drill = out.drill as Record<string, unknown>;
    if ("steps" in drill) drill.steps = cleanList(drill.steps);
  }
  if (isRecord(out.score)) out.score = Object.fromEntries(Object.entries(out.score).map(([key, value]) => [
    key,
    ["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"].includes(key)
      ? cleanFields(value, ["reason"])
      : value,
  ]));
  if (isRecord(out.checkpoint_cues)) out.checkpoint_cues = cleanFields(out.checkpoint_cues, ["address", "top", "impact", "follow_through"]);
  return out as T;
}

// A model response must not be saved with an empty required explanation after
// cleanup, nor may a partial translation fall back to old-language prose.
// Optional lists/cues can be empty; no replacement coaching is invented.
export function hasCompleteCaddieFeedback(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const list = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
  return text(value.summary) && list(value.strengths) && list(value.limitations)
    && Array.isArray(value.work_on) && value.work_on.every((w) => isRecord(w) && text(w.issue) && text(w.why_it_matters))
    && isRecord(value.focus) && text(value.focus.title) && text(value.focus.instruction)
    && isRecord(value.drill) && text(value.drill.name) && list(value.drill.steps) && value.drill.steps.length > 0
    && isRecord(value.score) && ["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"]
      .every((key) => isRecord(value.score) && isRecord(value.score[key]) && text(value.score[key].reason));
}

export const CADDIE_FEEDBACK_CONTENT_RULE =
  "Return only golfer-facing observations, coaching and evidence limitations in the requested language. Do not include statements about following instructions or constraints, completing analysis or translation, system prompts, or processing status in any feedback field.";
