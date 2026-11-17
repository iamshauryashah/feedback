// One shared SQLite-backed Durable Object for all feedback sites.
// Only the Worker calls this object through its binding.
const STATUSES = ['Inbox', 'Planned', 'In Progress', 'Done', 'Not Planned'];

export class FeedbackStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      email TEXT NOT NULL,
      site TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Inbox',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS feedback_recent ON feedback(created_at DESC)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      next_allowed INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    )`);
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: 'Invalid internal request' }, { status: 400 }); }

    if (url.pathname === '/list') {
      const fields = body.admin
        ? 'id,message,email,site,status,created_at,updated_at'
        : 'id,message,site,status,created_at,updated_at';
      const items = this.sql.exec(`SELECT ${fields} FROM feedback ORDER BY created_at DESC LIMIT 500`).toArray();
      return Response.json({ items });
    }

    // Read-only, email-free pagination for the platform's MCP triage integration.
    if (url.pathname === '/list-new') {
      const offset = body.offset, limit = body.limit;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        return Response.json({ error: 'Invalid pagination' }, { status: 400 });
      }
      const total = this.sql.exec("SELECT count(*) AS n FROM feedback WHERE status = 'Inbox'").toArray()[0].n;
      const items = this.sql.exec(
        "SELECT id,message,site,status,created_at,updated_at FROM feedback WHERE status = 'Inbox' ORDER BY created_at ASC,id ASC LIMIT ? OFFSET ?",
        limit, offset
      ).toArray();
      return Response.json({ items, total });
    }

    if (url.pathname === '/throttle') {
      const { key, now } = body;
      if (typeof key !== 'string' || !Number.isSafeInteger(now)) return Response.json({ error: 'Invalid throttle request' }, { status: 400 });
      const current = this.sql.exec('SELECT count,next_allowed,window_start FROM rate_limits WHERE key=?', key).toArray()[0];
      if (current && current.next_allowed > now) {
        return Response.json({ allowed: false, retryAfter: Math.max(1, Math.ceil((current.next_allowed - now) / 1000)) });
      }
      const reset = !current || now - current.window_start > 86400000;
      const count = reset ? 1 : Math.min(current.count + 1, 16);
      const delay = Math.min(3600000, 1000 * 2 ** count);
      this.sql.exec(`INSERT INTO rate_limits(key,count,next_allowed,window_start)
        VALUES (?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET count=excluded.count,next_allowed=excluded.next_allowed,window_start=excluded.window_start`,
        key, count, now + delay, reset ? now : current.window_start);
      return Response.json({ allowed: true });
    }

    if (url.pathname === '/submit') {
      const { id, message, email, site, now } = body;
      if (typeof id !== 'string' || typeof message !== 'string' || typeof email !== 'string' ||
          typeof site !== 'string' || typeof now !== 'string') {
        return Response.json({ error: 'Invalid record' }, { status: 400 });
      }
      this.sql.exec('INSERT INTO feedback(id,message,email,site,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        id, message, email, site, 'Inbox', now, now);
      return Response.json({ ok: true, id });
    }

    if (url.pathname === '/update') {
      const { id, status, now } = body;
      if (typeof id !== 'string' || !STATUSES.includes(status) || typeof now !== 'string') {
        return Response.json({ error: 'Invalid update' }, { status: 400 });
      }
      this.sql.exec('UPDATE feedback SET status=?,updated_at=? WHERE id=?', status, now, id);
      const exists = this.sql.exec('SELECT 1 FROM feedback WHERE id=?', id).toArray().length > 0;
      return Response.json(exists ? { ok: true } : { error: 'Not found' }, { status: exists ? 200 : 404 });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
