// Cloudflare Workers entrypoint for CCL assets + D1-backed authentication.
// Requires env.DB (D1), env.ASSETS (static assets), and ADMIN_TOKEN secret for claim review.
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const encoder = new TextEncoder();
const bytesToHex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = hex => Uint8Array.from(hex.match(/../g) || [], x => parseInt(x, 16));
const sha256 = async value => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const random = (n = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
async function hashPassword(password, salt) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
 const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(salt), iterations: 310000, hash: 'SHA-256' }, key, 256);
 return bytesToHex(new Uint8Array(hash));
}
function constantTime(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
const cookie = (token, maxAge) => 'ccl_session=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
async function currentUser(request, db) {
 const token = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ccl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if (!token) return null;
 const record = await db.prepare('SELECT users.id, users.username, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').bind(await sha256(token), Date.now()).first();
 return record || null;
}
async function body(request) { try { return await request.json(); } catch { return {}; } }
async function handle(request, env) {
 const url = new URL(request.url), path = url.pathname;
 if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
 if (!env.DB) return json({ error: 'Account database is not configured.' }, 503);
 if (path === '/api/health' && request.method === 'GET') {
   const tables = {};
   for (const name of ['users','sessions','claims']) {
     try {
       const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
       tables[name] = Boolean(result);
     } catch (e) {
       console.error('D1 health check failed:', e);
       return json({ ok:false, database:'query_failed', tables, hint:'Check Worker logs and D1 binding.' }, 503);
     }
   }
   return json({ ok:Object.values(tables).every(Boolean), database:'connected', tables, hint:Object.values(tables).every(Boolean) ? undefined : 'Apply the full schema.sql to the remote D1 database.' }, Object.values(tables).every(Boolean) ? 200 : 503);
 }
 if (request.method === 'POST' && request.headers.get('origin') && new URL(request.headers.get('origin')).origin !== url.origin) return json({ error: 'Invalid origin.' }, 403);
 if (request.method === 'POST' && !String(request.headers.get('content-type')).includes('application/json')) return json({ error: 'Expected JSON.' }, 415);
 if (path === '/api/auth/register' && request.method === 'POST') {
   const data = await body(request);
   const username = String(data.username || '').trim(), email = String(data.email || '').trim().toLowerCase(), password = String(data.password || '');
   if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) return json({ error: 'Username must be 3–24 letters, numbers, underscores, or hyphens.' }, 400);
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid email address.' }, 400);
   if (password.length < 12 || password.length > 256) return json({ error: 'Password must be 12–256 characters.' }, 400);
   const id = crypto.randomUUID(), salt = random(16), passwordHash = await hashPassword(password, salt);
   try { await env.DB.prepare('INSERT INTO users (id,username,email,password_hash,password_salt) VALUES (?,?,?,?,?)').bind(id,username,email,passwordHash,salt).run(); }
   catch (e) { console.error('Registration insert:',e); if (String(e).includes('UNIQUE constraint failed')) return json({ error: 'That username or email is already registered.' }, 409); return json({ error: 'Account database error. Check the D1 schema and Worker logs.' }, 503); }
   const token = random(), expiry = Date.now() + 30*24*3600*1000;
   await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token),id,expiry).run();
   return json({ user: { id, username, email } }, 201, { 'set-cookie': cookie(token, 30*24*3600) });
 }
 if (path === '/api/auth/login' && request.method === 'POST') {
   const data = await body(request), login = String(data.login || '').trim(), password = String(data.password || '');
   const user = await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').bind(login,login).first();
   // Perform the same expensive hash operation for missing users to reduce enumeration timing.
   const salt = user?.password_salt || '00000000000000000000000000000000';
   const hash = await hashPassword(password, salt);
   if (!user || !constantTime(hash,user.password_hash)) return json({ error: 'Invalid username/email or password.' }, 401);
   const token = random(), expiry = Date.now() + 30*24*3600*1000;
   await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token),user.id,expiry).run();
   return json({ user: { id:user.id, username:user.username, email:user.email } }, 200, { 'set-cookie': cookie(token, 30*24*3600) });
 }
 if (path === '/api/auth/me' && request.method === 'GET') {
   const user = await currentUser(request, env.DB);
   if (!user) return json({ user: null });
   const claims = await env.DB.prepare('SELECT leaderboard_username,status,created_at FROM claims WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all();
   return json({ user, claims: claims.results });
 }
 if (path === '/api/auth/logout' && request.method === 'POST') {
   const token = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ccl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
   if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
   return json({ ok:true }, 200, { 'set-cookie': cookie('', 0) });
 }
 if (path === '/api/claims' && request.method === 'POST') {
   const user = await currentUser(request, env.DB);
   if (!user) return json({ error: 'Log in first.' }, 401);
   const data = await body(request), name = String(data.username || '').trim(), evidence = String(data.evidence || '').trim();
   if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || evidence.length < 15 || evidence.length > 1500) return json({ error: 'Provide the leaderboard username and ownership evidence (15–1500 characters).' }, 400);
   const claimed = await env.DB.prepare("SELECT id FROM claims WHERE leaderboard_username=? COLLATE NOCASE AND status='approved'").bind(name).first();
   if (claimed) return json({ error: 'That leaderboard profile is already claimed.' }, 409);
   try { await env.DB.prepare('INSERT INTO claims (id,user_id,leaderboard_username,evidence) VALUES (?,?,?,?)').bind(crypto.randomUUID(),user.id,name,evidence).run(); }
   catch { return json({ error: 'A claim for that username has already been submitted.' }, 409); }
   return json({ ok:true, status:'pending' }, 201);
 }
 if (path === '/api/claims/review' && request.method === 'POST') {
   const admin = request.headers.get('authorization') || '';
   if (!env.ADMIN_TOKEN || !constantTime(admin, 'Bearer ' + env.ADMIN_TOKEN)) return json({ error:'Unauthorized' }, 401);
   const data = await body(request);
   if (!['approved','rejected'].includes(data.status)) return json({ error:'Invalid status' },400);
   const result = await env.DB.prepare("UPDATE claims SET status=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(data.status,String(data.id || '')).run();
   return json({ updated: result.meta.changes });
 }
 return json({ error:'Not found' }, 404);
}
export default { async fetch(request, env) { try { return await handle(request,env); } catch(e) { console.error(e); return json({ error:'Service temporarily unavailable.' },500); } } };
