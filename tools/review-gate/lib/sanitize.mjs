// Reviewer payload sanitizer. Anything unsafe is removed AND reported; any
// secret or personal-data hit blocks the send (USER_APPROVAL_REQUIRED) so Micky
// sees what was nearly sent. Nothing here ever reads files outside the diff it is given.
import { matchesAny } from "./util.mjs";

export const EXCLUDED_PATH_GLOBS = [
  "**/.env",
  "**/.env.*",
  ".env",
  ".env.*",
  "**/*.key",
  "**/*.pem",
  "**/*.p8",
  "**/*.p12",
  "**/*.mobileprovision",
  ".claude/**",
  ".review-gate/**",
  "supabase/.temp/**",
  "node_modules/**",
  "dist/**",
  "ios/App/App/public/**",
  "**/package-lock.json",
  "**/bun.lock",
  "**/yarn.lock",
];
const ENV_EXAMPLE = /(^|\/)\.env\.example$/i;

export const MEDIA_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|jpg|jpeg|png|heic|heif|gif|webp|bmp|tiff?|svg|pdf|zip|gz|tar|mp3|wav|m4a|aac|ttf|otf|woff2?)$/i;

// type, pattern
export const SECRET_PATTERNS = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ["openai-key", /\bsk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g],
  ["supabase-secret", /\bsb_secret_[A-Za-z0-9_-]{10,}\b/g],
  ["supabase-publishable", /\bsb_publishable_[A-Za-z0-9_-]{10,}\b/g],
  ["service-role", /service_role[^\n]{0,40}?[:=]\s*['"]?[A-Za-z0-9._-]{20,}/gi],
  ["telegram-bot-token", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g],
  ["aws-access-key", /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["aws-secret", /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{30,}/gi],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["github-token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g],
  ["generic-secret", /\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret)\b\s*[:=]\s*\\?['"`][^'"`\s\\]{16,}\\?['"`]/gi],
];

export const PII_PATTERNS = [
  ["email", /\b[A-Za-z0-9._%+-]+@(?!example\.(com|org|net)\b|anthropic\.com\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ["phone", /(?<![\w.-])(\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w.-])/g],
  ["storage-listing", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(caddie|swing|post|avatar)[-\w]*\.(mov|mp4|m4v|jpg|jpeg|png|heic|webp)\b/gi],
];

export function isExcludedPath(path) {
  if (ENV_EXAMPLE.test(path)) return false;
  return matchesAny(path, EXCLUDED_PATH_GLOBS);
}

export function isMediaPath(path) {
  return MEDIA_EXT.test(path);
}

export function looksBinary(text) {
  return typeof text === "string" && (text.includes("\u0000") || /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text));
}

// Replaces every match with ‹REDACTED:type›; returns hits per type.
export function redact(text, patterns) {
  let out = String(text ?? "");
  const hits = {};
  for (const [type, re] of patterns) {
    out = out.replace(re, () => {
      hits[type] = (hits[type] ?? 0) + 1;
      return `‹REDACTED:${type}›`;
    });
  }
  return { text: out, hits };
}

// Splits a unified diff into per-file sections.
export function splitDiff(diff) {
  const sections = [];
  const re = /^diff --git a\/(.+?) b\/(.+)$/gm;
  const starts = [];
  let m;
  while ((m = re.exec(diff))) starts.push({ index: m.index, path: m[2] });
  for (let i = 0; i < starts.length; i++) {
    sections.push({ path: starts[i].path, text: diff.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : diff.length) });
  }
  return sections;
}

function mergeHits(into, hits) {
  for (const [k, v] of Object.entries(hits)) into[k] = (into[k] ?? 0) + v;
}

/**
 * Builds the sanitized pieces of a reviewer request.
 * @returns {{ diff, file_contents, excluded, media, secretHits, piiHits, blocked, blockReasons }}
 */
export function sanitizeWork({ diff, fileContents = [] }, limits) {
  const excluded = [];
  const media = [];
  const secretHits = {};
  const piiHits = {};
  const kept = [];

  for (const section of splitDiff(String(diff ?? ""))) {
    if (isExcludedPath(section.path)) {
      excluded.push(section.path);
      continue;
    }
    if (isMediaPath(section.path) || looksBinary(section.text)) {
      media.push(section.path);
      continue;
    }
    const s = redact(section.text, SECRET_PATTERNS);
    mergeHits(secretHits, s.hits);
    const p = redact(s.text, PII_PATTERNS);
    mergeHits(piiHits, p.hits);
    kept.push({ path: section.path, text: p.text });
  }

  const contents = [];
  for (const fc of fileContents) {
    if (isExcludedPath(fc.path)) {
      excluded.push(fc.path);
      continue;
    }
    if (isMediaPath(fc.path) || looksBinary(fc.content)) {
      media.push(fc.path);
      continue;
    }
    const s = redact(fc.content, SECRET_PATTERNS);
    mergeHits(secretHits, s.hits);
    const p = redact(s.text, PII_PATTERNS);
    mergeHits(piiHits, p.hits);
    contents.push({ path: fc.path, content: p.text, reason: fc.reason ?? "context" });
  }

  const blockReasons = [];
  if (media.length) blockReasons.push(`media/binary files in the change set: ${[...new Set(media)].join(", ")}`);
  if (Object.keys(secretHits).length) blockReasons.push(`secret-like values redacted: ${Object.entries(secretHits).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  if (Object.keys(piiHits).length) blockReasons.push(`personal/private data redacted: ${Object.entries(piiHits).map(([k, v]) => `${k}×${v}`).join(", ")}`);

  // File contents only within their own limits.
  let limitedContents = contents.slice(0, limits.maxFileContentsFiles);
  let total = 0;
  limitedContents = limitedContents.filter((c) => (total += c.content.length) <= limits.maxFileContentsChars);

  return {
    diff: kept.map((k) => k.text).join(""),
    file_contents: limitedContents,
    excluded: [...new Set(excluded)],
    media: [...new Set(media)],
    secretHits,
    piiHits,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}

// Enforces the total payload size: drop file_contents, then truncate the diff
// per file; if it still does not fit, the caller must block (split the task).
export function fitPayload(request, maxChars) {
  const size = (r) => JSON.stringify(r).length;
  if (size(request) <= maxChars) return { request, fitted: true, trimmed: false };
  const r = { ...request, file_contents: [] };
  if (size(r) <= maxChars) return { request: r, fitted: true, trimmed: true };
  const overhead = size({ ...r, diff: "" });
  const budget = maxChars - overhead - 200;
  if (budget < 2000) return { request: r, fitted: false, trimmed: true };
  const sections = splitDiff(r.diff);
  const per = Math.max(500, Math.floor(budget / Math.max(1, sections.length)));
  const truncated = sections.map((s) => (s.text.length > per ? s.text.slice(0, per) + "\n[... truncated by review-gate size limit ...]\n" : s.text)).join("");
  const r2 = { ...r, diff: truncated };
  return { request: r2, fitted: size(r2) <= maxChars, trimmed: true };
}
