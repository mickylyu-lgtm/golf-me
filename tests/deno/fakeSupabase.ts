// In-memory stand-in for npm:@supabase/supabase-js@2, used ONLY by
// tests/deno/analyzeSwing.harness.ts (mapped in tests/deno/deno.json). It
// models just what analyze-swing touches: caddie_analyses (owner-scoped like
// its RLS, with the 20261107140000 trigger rules for attempt / charges /
// starts), the RPCs, Storage signing/upload/remove and auth.getUser().
// Never talks to a network or a real database.

export interface FakeRow {
  [key: string]: unknown;
  id: string;
  owner_id: string;
  status: string;
  attempt: number;
  attempt_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeDb {
  userId: string;
  rows: FakeRow[];
  charges: { analysis_id: string }[];
  starts: { analysis_id: string; attempt: number }[];
  diagnostics: Record<string, unknown>[];
  rpcCalls: string[];
  uploads: string[];
  removed: string[];
  // Test hook: called before an UPDATE is applied (simulates a concurrent writer).
  beforeUpdate?: (patch: Record<string, unknown>) => void | Promise<void>;
}

const STALE_MS = 6 * 60 * 1000;

export function newFakeDb(userId: string): FakeDb {
  return { userId, rows: [], charges: [], starts: [], diagnostics: [], rpcCalls: [], uploads: [], removed: [] };
}

function db(): FakeDb {
  const d = (globalThis as unknown as { __fakeDb?: FakeDb }).__fakeDb;
  if (!d) throw new Error("fake db not installed");
  return d;
}

class TriggerError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

type Filter = (row: FakeRow) => boolean;

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private filters: Filter[] = [];
  private orderBy?: { col: string; asc: boolean };
  private limitN?: number;
  private mode: "select" | "insert" | "update" = "select";
  private payload?: Record<string, unknown>;
  private wantRows = false;
  private singleMode: "none" | "single" | "maybe" = "none";
  private countMode = false;
  private head = false;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") {
      this.countMode = !!opts?.count;
      this.head = !!opts?.head;
    } else {
      this.wantRows = true;
    }
    return this;
  }
  insert(obj: Record<string, unknown>) {
    this.mode = "insert";
    this.payload = obj;
    return this;
  }
  update(obj: Record<string, unknown>) {
    this.mode = "update";
    this.payload = obj;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => typeof r[col] === "string" && (r[col] as string) >= v);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private visible(): FakeRow[] {
    if (this.table === "community_posts") return [];
    return db().rows.filter((r) => r.owner_id === db().userId);
  }

  private shape(rows: FakeRow[]) {
    const out = rows.map((r) => ({ ...r }));
    if (this.singleMode === "single") {
      return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "expected one row" } };
    }
    if (this.singleMode === "maybe") {
      return out.length <= 1 ? { data: out[0] ?? null, error: null } : { data: null, error: { message: "multiple rows" } };
    }
    return { data: out, error: null };
  }

  private async run(): Promise<{ data: unknown; error: unknown; count?: number | null }> {
    await Promise.resolve();
    const d = db();
    if (this.mode === "insert") {
      const now = new Date().toISOString();
      const row: FakeRow = {
        id: crypto.randomUUID(),
        source_media_url: null,
        source_media_path: null,
        thumbnail_url: null,
        thumbnail_path: null,
        error_message: null,
        trim_start_seconds: null,
        trim_end_seconds: null,
        failure_category: null,
        failure_stage: null,
        stage: null,
        ...this.payload,
        // enforce_caddie_daily_limit(): the database owns these.
        attempt: 1,
        attempt_started_at: now,
        created_at: now,
        updated_at: now,
        owner_id: this.payload!.owner_id as string,
        status: this.payload!.status as string,
      };
      d.rows.push(row);
      if (row.status === "processing") d.starts.push({ analysis_id: row.id, attempt: 1 });
      return this.shape([row]);
    }
    let rows = this.visible().filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") {
      if (d.beforeUpdate) await d.beforeUpdate(this.payload!);
      // Re-evaluate after the hook, like a row lock + recheck.
      rows = this.visible().filter((r) => this.filters.every((f) => f(r)));
      const changed: FakeRow[] = [];
      for (const row of rows) {
        const patch = { ...this.payload };
        // private.guard_caddie_job()
        if (patch.attempt !== undefined && patch.attempt !== row.attempt) {
          const stale = row.status === "processing" && Date.now() - new Date(row.attempt_started_at ?? row.created_at).getTime() > STALE_MS;
          if (patch.attempt !== row.attempt + 1 || patch.status !== "processing") {
            return { data: null, error: new TriggerError("can't restart that way", "caddie_retry_invalid") };
          }
          if (!(row.status === "failed" || stale)) return { data: null, error: new TriggerError("already running", "caddie_retry_not_allowed") };
          if ((patch.attempt as number) > 4) return { data: null, error: new TriggerError("retry cap", "caddie_retry_cap") };
          patch.attempt_started_at = new Date().toISOString();
          d.starts.push({ analysis_id: row.id, attempt: patch.attempt as number });
        } else {
          delete patch.attempt_started_at;
        }
        const wasComplete = row.status === "complete";
        Object.assign(row, patch, { updated_at: new Date().toISOString() });
        // private.charge_caddie_allowance()
        if (row.status === "complete" && !wasComplete && !d.charges.some((c) => c.analysis_id === row.id)) d.charges.push({ analysis_id: row.id });
        changed.push(row);
      }
      return this.wantRows ? this.shape(changed) : { data: null, error: null };
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((x, y) => (String(x[col]) < String(y[col]) ? (asc ? -1 : 1) : String(x[col]) > String(y[col]) ? (asc ? 1 : -1) : 0));
    }
    if (this.limitN !== undefined) rows = rows.slice(0, this.limitN);
    if (this.countMode) return { data: this.head ? null : rows, error: null, count: rows.length };
    return this.shape(rows);
  }
}

export function createClient(_url: string, _key: string, _opts?: unknown) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: db().userId } }, error: null }),
    },
    from: (table: string) => new Query(table),
    rpc: (name: string, args?: Record<string, unknown>) => {
      const d = db();
      d.rpcCalls.push(name);
      if (name === "sweep_stale_caddie_jobs") {
        let n = 0;
        for (const r of d.rows) {
          if (r.owner_id === d.userId && r.status === "processing" && Date.now() - new Date(r.attempt_started_at ?? r.created_at).getTime() > 390_000) {
            Object.assign(r, { status: "failed", failure_category: "worker_lost", failure_stage: r.stage ?? "queued" });
            n++;
          }
        }
        return Promise.resolve({ data: n, error: null });
      }
      if (name === "caddie_allowance_status") {
        const used = d.charges.length + d.rows.filter((r) => r.status === "processing").length;
        return Promise.resolve({ data: [{ used, daily_limit: 30, starts: d.starts.length, start_ceiling: 60 }], error: null });
      }
      if (name === "record_caddie_diagnostic") {
        d.diagnostics.push({ ...args });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/caddie-media/${path}?token=SIGNEDTOKEN123` }, error: null }),
        upload: (path: string) => {
          const d = db();
          if (d.uploads.includes(path)) return Promise.resolve({ data: null, error: { message: "The resource already exists" } });
          d.uploads.push(path);
          return Promise.resolve({ data: { path }, error: null });
        },
        remove: (paths: string[]) => {
          db().removed.push(...paths);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  };
}
