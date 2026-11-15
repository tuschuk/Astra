/**
 * `export-data` — the server function that hands a lifter a copy of everything they own on Astra
 * (B32, NFR-6). The decisions are in `handler.ts`; this file is only wiring.
 *
 * Called by the phone from Settings → Export your data, with the lifter's login token:
 *   POST /functions/v1/export-data   (no body needed)
 * The platform's JWT check is on, so a request without a valid login never reaches this code.
 *
 * ONE database client, acting AS THE CALLER (their token). There is no server key anywhere in
 * this function: every read goes through the database's security rules, so even a bug in the
 * handler could only ever return rows the caller is allowed to read — and the handler filters
 * those down to rows the caller owns.
 * Answers: 200 with the document; 401 without a valid login; 405 for anything but POST; 500 if
 * the database fails (the app says so and the lifter can simply try again).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handleExportRequest, type ExportDeps, type Row } from './handler.ts';

/** A JSON response with the given status. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Throws a database error as a normal Error, naming what was being done. */
function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/**
 * The real reads, all as the caller. The handler asks for every column (`*`) of the lifter's
 * rows, so the export is complete, and does the paging itself; these run one request each.
 */
function supabaseDeps(asCaller: SupabaseClient): ExportDeps {
  return {
    // The single row (profile, settings or body data) whose `column` is the caller's id.
    async readOne(table, column, userId) {
      const { data, error } = await asCaller.from(table).select('*').eq(column, userId).maybeSingle();
      check(error, `Reading ${table} failed`);
      return (data as Row | null) ?? null;
    },
    // One page of matching rows, in id order so consecutive pages never overlap or skip.
    async readPage({ table, columns, filter, from, to }) {
      const base = asCaller.from(table).select(columns);
      const filtered = 'eq' in filter ? base.eq(filter.column, filter.eq) : base.in(filter.column, [...filter.in]);
      const { data, error } = await filtered.order('id', { ascending: true }).range(from, to);
      check(error, `Reading ${table} failed`);
      return (data ?? []) as unknown as Row[];
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Sign in first' });

  const asCaller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });

  try {
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: who, error: whoError } = await asCaller.auth.getUser(token);
    if (whoError || !who.user) return json(401, { error: 'Sign in first' });

    const result = await handleExportRequest({ id: who.user.id, email: who.user.email ?? null }, supabaseDeps(asCaller));
    return json(result.status, result.body);
  } catch (error) {
    console.error('export-data failed', error);
    return json(500, { error: 'Your export could not be made right now' });
  }
});
