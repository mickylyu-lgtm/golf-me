// Shell command splitting for the PreToolUse classifier. Parses only — never
// executes anything.
//
// splitShell(cmd, dialect) -> { segments, bare, heredocBodies, unbalanced }
//   segments      simple commands, each { text, bare, heredoc }
//                   text    verbatim (quotes kept, so quoted paths are still seen)
//                   bare    quoted contents removed (so message text such as a commit
//                           message cannot fake an operator, a verb or a gate path)
//                   heredoc bodies of heredocs this command declared ("" if none)
//   bare          the whole command with quoted contents and heredoc bodies removed
//   heredocBodies all heredoc bodies (for conservative whole-command checks)
//   unbalanced    true when quotes, substitutions or heredocs do not close;
//                 callers must treat the command as unclassifiable
//
// Separators (&&, ||, ;, |, |&, background &, newline, and ( ) in bash) split
// segments only outside quotes and heredoc bodies. Command substitutions —
// $(...), `...`, <(...), >(...) — run commands even inside double quotes and
// unquoted-delimiter heredocs, so their contents are returned as extra segments.
// Dialect "ps" (PowerShell): backtick is an escape, $() is a subexpression,
// @'…'@ / @"…"@ here-strings, no bash heredocs, parentheses are not separators.

const MAX_DEPTH = 6;

function readParen(s, j) {
  // s[j] is the first char after "(" ; returns the index of the matching ")" or -1
  let depth = 1;
  let quote = null;
  for (let k = j; k < s.length; k++) {
    const ch = s[k];
    if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (quote === '"') {
      if (ch === "\\") k++;
      else if (ch === '"') quote = null;
    } else if (ch === "\\") k++;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return k;
  }
  return -1;
}

function readBacktick(s, j) {
  for (let k = j; k < s.length; k++) {
    if (s[k] === "\\") k++;
    else if (s[k] === "`") return k;
  }
  return -1;
}

const WRAPPER = /^(?:(?:do|then|else|elif|if|while|until|time|nohup|!|\{|\})\s+|timeout\s+(?:-[a-z]+\s+)?\d+[smhd]?\s+)/;
const ASSIGNMENT = /^[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+/;

function normalize(s) {
  let t = s.trim().replace(/^\(+/, "").replace(/\)+$/, "").trim();
  for (let guard = 0; guard < 10; guard++) {
    const before = t;
    t = t.replace(WRAPPER, "").replace(ASSIGNMENT, "").trim();
    if (t === before) break;
  }
  return /^(done|fi|esac|\{|\}|do|then|else)$/.test(t) ? "" : t;
}

export function splitShell(cmd, dialect = "bash", depth = 0) {
  const s = String(cmd ?? "");
  const ps = dialect === "ps";
  const segments = [];
  const heredocBodies = [];
  let unbalanced = depth > MAX_DEPTH;
  if (unbalanced) return { segments: [{ text: s, bare: s, heredoc: "" }], bare: s, heredocBodies, unbalanced };

  let text = "";
  let bare = "";
  let bareAll = "";
  let heredoc = "";
  const pending = []; // heredocs declared on the current line: { delim, expand, strip }

  const flush = () => {
    const t = normalize(text);
    if (t) segments.push({ text: t, bare: normalize(bare), heredoc });
    text = "";
    bare = "";
    heredoc = "";
  };
  const addSub = (inner) => {
    const r = splitShell(inner, dialect, depth + 1);
    segments.push(...r.segments);
    heredocBodies.push(...r.heredocBodies);
    if (r.unbalanced) unbalanced = true;
  };
  // $() and backticks inside an expanding context with no quote rules of its own
  const scanExpansions = (body) => {
    for (let k = 0; k < body.length; k++) {
      if (body[k] === "\\") k++;
      else if (body[k] === "$" && body[k + 1] === "(") {
        const e = readParen(body, k + 2);
        if (e < 0) return void (unbalanced = true);
        addSub(body.slice(k + 2, e));
        k = e;
      } else if (!ps && body[k] === "`") {
        const e = readBacktick(body, k + 1);
        if (e < 0) return void (unbalanced = true);
        addSub(body.slice(k + 1, e));
        k = e;
      }
    }
  };
  const put = (raw, bareRepl = raw) => {
    text += raw;
    bare += bareRepl;
    bareAll += bareRepl;
  };

  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];

    // escapes
    if ((!ps && c === "\\") || (ps && c === "`")) {
      put(s.slice(i, i + 2));
      i += 2;
      continue;
    }
    // PowerShell here-strings: @' ... '@ (literal) and @" ... "@ (expanding)
    if (ps && c === "@" && (s[i + 1] === "'" || s[i + 1] === '"')) {
      const q = s[i + 1];
      const end = s.indexOf(`\n${q}@`, i + 2);
      if (end < 0) {
        unbalanced = true;
        put(s.slice(i), "@''@");
        break;
      }
      const body = s.slice(i + 2, end);
      heredocBodies.push(body);
      heredoc += body;
      if (q === '"') scanExpansions(body);
      put(s.slice(i, end + 3), "@''@");
      i = end + 3;
      continue;
    }
    // single quotes: fully literal
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) {
        unbalanced = true;
        put(s.slice(i), "''");
        break;
      }
      put(s.slice(i, j + 1), "''");
      i = j + 1;
      continue;
    }
    // double quotes: literal except substitutions
    if (c === '"') {
      let k = i + 1;
      let closed = false;
      while (k < n) {
        const ch = s[k];
        if ((!ps && ch === "\\") || (ps && ch === "`")) {
          k += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          break;
        }
        if (ch === "$" && s[k + 1] === "(") {
          const e = readParen(s, k + 2);
          if (e < 0) break;
          addSub(s.slice(k + 2, e));
          k = e + 1;
          continue;
        }
        if (!ps && ch === "`") {
          const e = readBacktick(s, k + 1);
          if (e < 0) break;
          addSub(s.slice(k + 1, e));
          k = e + 1;
          continue;
        }
        k++;
      }
      if (!closed) {
        unbalanced = true;
        put(s.slice(i), '""');
        break;
      }
      put(s.slice(i, k + 1), '""');
      i = k + 1;
      continue;
    }
    // unquoted substitutions
    if ((c === "$" || (!ps && (c === "<" || c === ">"))) && s[i + 1] === "(") {
      const e = readParen(s, i + 2);
      if (e < 0) {
        unbalanced = true;
        put(s.slice(i));
        break;
      }
      addSub(s.slice(i + 2, e));
      put(s.slice(i, e + 1), "$()");
      i = e + 1;
      continue;
    }
    if (!ps && c === "`") {
      const e = readBacktick(s, i + 1);
      if (e < 0) {
        unbalanced = true;
        put(s.slice(i));
        break;
      }
      addSub(s.slice(i + 1, e));
      put(s.slice(i, e + 1), "``");
      i = e + 1;
      continue;
    }
    // comments
    if (c === "#" && (text === "" || /\s$/.test(text))) {
      const e = s.indexOf("\n", i);
      i = e < 0 ? n : e;
      continue;
    }
    // bash heredoc declarations: <<EOF, <<-EOF, <<'EOF', <<"EOF", <<\EOF (not <<< here-strings)
    if (!ps && c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
      const m = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|(\\?)([A-Za-z_][\w.-]*))/.exec(s.slice(i));
      if (m) {
        const quoted = m[2] !== undefined || m[3] !== undefined || m[4] === "\\";
        pending.push({ delim: m[2] ?? m[3] ?? m[5], expand: !quoted, strip: m[1] === "-" });
        put(m[0], "<<");
        i += m[0].length;
        continue;
      }
    }
    // newline: ends the command; heredoc bodies follow it
    if (c === "\n") {
      const owner = pending.length ? { text, bare } : null;
      i++;
      let bodies = "";
      for (const h of pending) {
        const start = i;
        let found = false;
        while (i <= n) {
          let e = s.indexOf("\n", i);
          if (e < 0) e = n;
          let line = s.slice(i, e).replace(/\r$/, "");
          if (h.strip) line = line.replace(/^\t+/, "");
          if (line === h.delim) {
            const body = s.slice(start, i);
            heredocBodies.push(body);
            bodies += body;
            if (h.expand) scanExpansions(body);
            i = Math.min(e + 1, n);
            found = true;
            break;
          }
          if (e >= n) {
            i = n;
            break;
          }
          i = e + 1;
        }
        if (!found) unbalanced = true;
      }
      pending.length = 0;
      if (owner) heredoc += bodies;
      flush();
      bareAll += "\n";
      continue;
    }
    // separators
    if (c === ";") {
      flush();
      bareAll += ";";
      i++;
      continue;
    }
    if (c === "|") {
      flush();
      bareAll += "|";
      i += s[i + 1] === "|" || s[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === "&") {
      if (s[i + 1] === "&") {
        flush();
        bareAll += "&&";
        i += 2;
        continue;
      }
      const prev = text.slice(-1);
      if (prev === ">" || prev === "<" || s[i + 1] === ">") {
        put(c); // redirection such as 2>&1 or &>file
        i++;
        continue;
      }
      if (ps) {
        put(c); // PowerShell call operator
        i++;
        continue;
      }
      flush(); // background job
      bareAll += "&";
      i++;
      continue;
    }
    if (!ps && (c === "(" || c === ")")) {
      flush();
      bareAll += c;
      i++;
      continue;
    }
    put(c);
    i++;
  }
  if (pending.length) unbalanced = true; // heredoc declared but no body followed
  flush();
  return { segments, bare: bareAll, heredocBodies, unbalanced };
}
