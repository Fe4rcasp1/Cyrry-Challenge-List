// Cloudflare Workers entrypoint for CCL assets + D1-backed authentication.
// Requires env.DB (D1), env.ASSETS (static assets), and ADMIN_TOKEN secret for claim review.
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const encoder = new TextEncoder();
const bytesToHex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = hex => Uint8Array.from(hex.match(/../g) || [], x => parseInt(x, 16));
const sha256 = async value => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const random = (n = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
// Workers currently caps WebCrypto PBKDF2 at 100,000 iterations; use a memory-hard KDF in a future auth upgrade.
async function hashPassword(password, salt) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
 const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
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
// GitHub backup: keep the token only in the Cloudflare Worker secret GITHUB_TOKEN.
// D1 remains the live source; a failed backup is reported and can be retried.
function githubBase64(text) {
 const bytes = new TextEncoder().encode(text);
 let binary = '';
 for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(binary);
}
async function backupLevelToGitHub(env, listType, levelPath, level) {
 if (!env.GITHUB_TOKEN) return {synced:false,reason:'GITHUB_TOKEN is not configured in Cloudflare Worker secrets.'};
 if (!['normal','platformer'].includes(listType)||!/^[A-Za-z0-9_-]{1,120}$/.test(levelPath)) return {synced:false,reason:'Invalid backup path.'};
 const endpoint='https://api.github.com/repos/Fe4rcasp1/Cyrry-Challenge-List/contents/data/'+encodeURIComponent(levelPath)+'.json';
 const headers={'Authorization':'Bearer '+env.GITHUB_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'CCL-Cloudflare-Backup','Content-Type':'application/json'};
 const content=githubBase64(JSON.stringify(level,null,2)+'\n');
 for(let attempt=0;attempt<3;attempt++){
   try {
     const current=await fetch(endpoint,{headers});
     if(!current.ok)return {synced:false,reason:'GitHub file lookup failed (HTTP '+current.status+').'};
     const file=await current.json();
     const result=await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({message:'Back up '+listType+' CCL level '+levelPath+' from admin dashboard',content,sha:file.sha})});
     if(result.ok)return {synced:true};
     if(![409,422].includes(result.status)||attempt===2)return {synced:false,reason:'GitHub commit failed (HTTP '+result.status+').'};
   }catch(e){if(attempt===2)return {synced:false,reason:'GitHub request failed: '+e.message};}
 }
 return {synced:false,reason:'GitHub backup could not be completed.'};
}
async function logLevelChange(env,actor,type,path,action,before,after,backup){
 const fields=[];
 if(before?.name!==after?.name)fields.push('name');
 if(before?.verifier!==after?.verifier)fields.push('verifier');
 if(JSON.stringify(before?.records)!==JSON.stringify(after?.records))fields.push('records');
 for(const key of ['author','creators','verification','percentToQualify','rating','Enjoyment'])if(JSON.stringify(before?.[key])!==JSON.stringify(after?.[key]))fields.push(key);
 const summary=action+': '+(fields.join(', ')||'level data');
 await env.DB.prepare('INSERT INTO ccl_level_history(id,list_type,level_path,action,actor_id,summary,before_json,after_json,github_synced) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),type,path,action,actor,summary,before?JSON.stringify(before):null,JSON.stringify(after),backup?.synced?1:0).run();
}
async function handle(request, env) {
 const url = new URL(request.url), path = url.pathname;
 if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
 if (path === '/api/impossible-levels' && request.method === 'GET') {
   // Source data directly from the Impossible CCL repository. Worker-to-Worker
   // requests to the separate Cloudflare hostname can be blocked (error 1042).
   const base = 'https://raw.githubusercontent.com/Fe4rcasp1/CCLimpossible/main/data/';
   const platformer = url.searchParams.get('list') === 'platformer';
   try {
     const indexResponse = await fetch(base + (platformer ? '_platformer.json' : '_list.json'), { headers: { 'Accept': 'application/json' } });
     if (!indexResponse.ok) throw new Error('Impossible index returned HTTP ' + indexResponse.status);
     const paths = await indexResponse.json();
     if (!Array.isArray(paths)) throw new Error('Invalid impossible list index');
     const safePaths = paths.filter(p => typeof p === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(p)).slice(0,500);
     const levels = new Array(safePaths.length).fill(null);
     // Limit concurrent GitHub requests to avoid overloading the origin.
     let cursor = 0;
     await Promise.all(Array.from({length: Math.min(8, safePaths.length)}, async () => {
       while (cursor < safePaths.length) {
         const index = cursor++;
         const levelPath = safePaths[index];
         try {
           const response = await fetch(base + encodeURIComponent(levelPath) + '.json', { headers: { 'Accept': 'application/json' } });
           if (!response.ok) continue;
           const level = await response.json();
           levels[index] = { ...level, path: levelPath, impossibleRank: index + 1, records: Array.isArray(level.records) ? level.records : [] };
         } catch (error) { console.warn('Impossible level failed:', levelPath, error); }
       }
     }));
     return json({ levels: levels.filter(Boolean) });
   } catch (error) {
     console.error('Impossible list load failed:', error);
     return json({ error: 'Unable to load unverified levels: ' + error.message }, 502);
   }
 }
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

 // Public teams and authenticated membership operations.
 if(path==='/api/teams'&&request.method==='GET'){
  const rows=await env.DB.prepare("SELECT t.id,t.name,t.tag,t.description,t.created_at,u.username AS owner,(SELECT COUNT(*) FROM ccl_team_members m WHERE m.team_id=t.id) AS members FROM ccl_teams t JOIN users u ON u.id=t.owner_id ORDER BY members DESC,t.name LIMIT 100").all();
  return json({teams:rows.results});
 }
 if(path==='/api/teams/profile'&&request.method==='GET'){
  const username=String(url.searchParams.get('username')||'').trim();
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(username))return json({clan:null});
  const clan=await env.DB.prepare("SELECT t.id,t.name,t.tag,t.description FROM ccl_teams t JOIN ccl_team_members m ON m.team_id=t.id JOIN users u ON u.id=m.user_id WHERE u.username=? COLLATE NOCASE OR EXISTS (SELECT 1 FROM claims c WHERE c.user_id=u.id AND c.status='approved' AND c.leaderboard_username=? COLLATE NOCASE) LIMIT 1").bind(username,username).first();
  return json({clan:clan||null});
 }
 if(path==='/api/teams/scores'&&request.method==='GET'){
  const rows=await env.DB.prepare("SELECT m.team_id,c.leaderboard_username FROM ccl_team_members m JOIN claims c ON c.user_id=m.user_id AND c.status='approved'").all();
  return json({members:rows.results});
 }
 if(path==='/api/teams/members'&&request.method==='GET'){
  const id=String(url.searchParams.get('id')||'');if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Invalid team.'},400);
  const rows=await env.DB.prepare("SELECT u.username,m.user_id,t.owner_id FROM ccl_team_members m JOIN users u ON u.id=m.user_id JOIN ccl_teams t ON t.id=m.team_id WHERE m.team_id=? ORDER BY m.joined_at LIMIT 100").bind(id).all();
  return json({members:rows.results.map(x=>({username:x.username,owner:x.user_id===x.owner_id}))});
 }
 if(path==='/api/teams/create'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  const data=await body(request),name=String(data.name||'').trim(),tag=String(data.tag||'').trim().toUpperCase(),description=String(data.description||'').trim();
  if(!/^[A-Za-z0-9 _-]{3,36}$/.test(name)||!/^[A-Z0-9]{2,6}$/.test(tag)||description.length>250)return json({error:'Invalid team name, tag or description.'},400);
  const existing=await env.DB.prepare('SELECT user_id FROM ccl_team_members WHERE user_id=?').bind(user.id).first();
  if(existing)return json({error:'Leave your current team first.'},409);
  const id=crypto.randomUUID();
  try{await env.DB.prepare('INSERT INTO ccl_teams(id,name,tag,description,owner_id) VALUES(?,?,?,?,?)').bind(id,name,tag,description,user.id).run();
   await env.DB.prepare('INSERT INTO ccl_team_members(team_id,user_id) VALUES(?,?)').bind(id,user.id).run();
  }catch(e){return json({error:'Team name or tag already exists.'},409);}
  return json({ok:true,id});
 }
 // Owner-generated, single-use invitation codes (expires after 7 days).
 if(path==='/api/teams/invites/create'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  const team=await env.DB.prepare('SELECT id FROM ccl_teams WHERE owner_id=?').bind(user.id).first();
  if(!team)return json({error:'Only a clan owner can create invite codes.'},403);
  const code='CCL-'+random(16).toUpperCase();
  const expires=new Date(Date.now()+7*86400000).toISOString();
  await env.DB.prepare('INSERT INTO ccl_team_invites(id,team_id,code_hash,created_by,expires_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),team.id,await sha256(code),user.id,expires).run();
  return json({code,expires_at:expires});
 }
 if(path==='/api/teams/invites/revoke'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  await env.DB.prepare('DELETE FROM ccl_team_invites WHERE team_id IN (SELECT id FROM ccl_teams WHERE owner_id=?) AND used_by IS NULL').bind(user.id).run();
  return json({ok:true});
 }
 if(path==='/api/teams/join'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  const data=await body(request),id=String(data.id||''),code=String(data.code||'').trim().toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^CCL-[A-F0-9]{32}$/.test(code))return json({error:'Enter a valid owner-provided invite code.'},400);
  const existing=await env.DB.prepare('SELECT user_id FROM ccl_team_members WHERE user_id=?').bind(user.id).first();
  if(existing)return json({error:'Leave your current clan first.'},409);
  const codeHash=await sha256(code);
  // UPDATE ... RETURNING atomically claims the invitation so two players cannot use it.
  const invite=await env.DB.prepare("UPDATE ccl_team_invites SET used_by=?,used_at=CURRENT_TIMESTAMP WHERE team_id=? AND code_hash=? AND used_by IS NULL AND expires_at>? RETURNING id").bind(user.id,id,codeHash,new Date().toISOString()).first();
  if(!invite)return json({error:'Invite code is invalid, expired, revoked, or already used.'},403);
  try{await env.DB.prepare('INSERT INTO ccl_team_members(team_id,user_id) VALUES(?,?)').bind(id,user.id).run();}
  catch(e){await env.DB.prepare('UPDATE ccl_team_invites SET used_by=NULL,used_at=NULL WHERE id=? AND used_by=?').bind(invite.id,user.id).run();return json({error:'Could not join clan. You may already be a member.'},409);}
  return json({ok:true});
 }
 if(path==='/api/teams/leave'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  const member=await env.DB.prepare('SELECT t.id,t.owner_id FROM ccl_team_members m JOIN ccl_teams t ON t.id=m.team_id WHERE m.user_id=?').bind(user.id).first();
  if(!member)return json({error:'You are not in a team.'},404);
  if(member.owner_id===user.id)return json({error:'Team owners must disband their team.'},409);
  await env.DB.prepare('DELETE FROM ccl_team_members WHERE user_id=?').bind(user.id).run();return json({ok:true});
 }
 if(path==='/api/teams/disband'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  const team=await env.DB.prepare('SELECT id FROM ccl_teams WHERE owner_id=?').bind(user.id).first();if(!team)return json({error:'You do not own a team.'},403);
  await env.DB.batch([env.DB.prepare('DELETE FROM ccl_team_members WHERE team_id=?').bind(team.id),env.DB.prepare('DELETE FROM ccl_teams WHERE id=?').bind(team.id)]);return json({ok:true});
 }
 if(path==='/api/levels/history'&&request.method==='GET'){
  const type=String(url.searchParams.get('list')||''),level=String(url.searchParams.get('path')||'');
  if(!['normal','platformer'].includes(type)||!/^[A-Za-z0-9_-]{1,120}$/.test(level))return json({error:'Invalid level.'},400);
  const rows=await env.DB.prepare("SELECT h.id,h.action,h.summary,h.github_synced,h.created_at,u.username AS editor FROM ccl_level_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.list_type=? AND h.level_path=? ORDER BY h.created_at DESC LIMIT 100").bind(type,level).all();
  return json({history:rows.results});
 }
 if (path === '/api/notifications' && request.method === 'GET') {
   const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
   const rows=await env.DB.prepare("SELECT id,kind,message,link,is_read,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 80").bind(user.id).all();
   return json({notifications:rows.results,unread:rows.results.filter(x=>!x.is_read).length});
 }
 if (path === '/api/notifications/read' && request.method === 'POST') {
   const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
   const data=await body(request),id=String(data.id||'');
   if(id==='all')await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE user_id=?").bind(user.id).run();
   else if(/^[0-9a-f-]{36}$/i.test(id))await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?").bind(user.id,id).run();
   else return json({error:'Invalid notification.'},400);
   return json({ok:true});
 }
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
 // All staff permissions are resolved from D1 on every request, never trusted from client state.
 if (path.startsWith('/api/admin/')) {
   const user = await currentUser(request, env.DB);
   if (!user) return json({ error:'Log in to a staff account.' }, 401);
   const roleRow = await env.DB.prepare('SELECT role FROM account_roles WHERE user_id=?').bind(user.id).first();
   const role = roleRow?.role || '';
   const canReview = ['owner','admin','moderator'].includes(role);
   const canEdit = ['owner','admin','editor'].includes(role);
   if (path === '/api/admin/me' && request.method === 'GET') return json({ role });
   if (!role) return json({ error:'Staff access required.' }, 403);
   if (path === '/api/admin/claims' && request.method === 'GET') {
     if (!canReview) return json({error:'Not permitted.'},403);
     const rows = await env.DB.prepare("SELECT claims.id,claims.leaderboard_username,claims.evidence,claims.created_at,users.username AS account_username,users.email FROM claims JOIN users ON users.id=claims.user_id WHERE claims.status='pending' ORDER BY claims.created_at ASC LIMIT 200").all();
     return json({claims:rows.results});
   }
   if (path === '/api/admin/claims/review' && request.method === 'POST') {
     if (!canReview) return json({error:'Not permitted.'},403);
     const data = await body(request);
     if (!['approved','rejected'].includes(data.status) || !/^[0-9a-f-]{36}$/i.test(String(data.id||''))) return json({error:'Invalid claim or status.'},400);
     try {
       const result = await env.DB.prepare("UPDATE claims SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(data.status,data.id).run();
       if (!result.meta.changes) return json({error:'Claim not pending or not found.'},404);
       await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'claim_'+data.status,data.id).run();
       const claim=await env.DB.prepare('SELECT user_id,leaderboard_username FROM claims WHERE id=?').bind(data.id).first();
       if(claim)await env.DB.prepare('INSERT INTO notifications(id,user_id,kind,message,link) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),claim.user_id,'claim','Your profile claim for '+claim.leaderboard_username+' was '+data.status+'.','/#/account').run();
       return json({ok:true});
     } catch(e) { console.error(e); return json({error:'Could not review claim; it may already be owned.'},409); }
   }
   if (path === '/api/admin/users' && request.method === 'GET') {
     if (role !== 'owner') return json({error:'Owner role required.'},403);
     const rows=await env.DB.prepare('SELECT users.id,users.username,account_roles.role FROM users LEFT JOIN account_roles ON users.id=account_roles.user_id ORDER BY users.username LIMIT 500').all();
     return json({users:rows.results});
   }
   if (path === '/api/admin/users/delete' && request.method === 'POST') {
     // Account deletion is owner-only, never self-service through the staff API.
     if (role !== 'owner') return json({error:'Owner role required.'},403);
     const data = await body(request);
     const targetId = String(data.userId || '');
     const confirmation = String(data.confirmUsername || '');
     if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({error:'Invalid account ID.'},400);
     if (targetId === user.id) return json({error:'You cannot delete your own account.'},403);
     const target = await env.DB.prepare('SELECT id,username FROM users WHERE id=?').bind(targetId).first();
     if (!target) return json({error:'Account not found.'},404);
     if (target.username !== confirmation) return json({error:'Username confirmation did not match.'},400);
     const targetRole = await env.DB.prepare('SELECT role FROM account_roles WHERE user_id=?').bind(targetId).first();
     if (targetRole?.role === 'owner') return json({error:'Owner accounts cannot be deleted here. Reassign their role first.'},403);
     // Deleting associated sessions and claims explicitly works even if D1 foreign keys
     // were not enabled in the original migration. Keep audit history intact.
     await env.DB.batch([
       env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(targetId),
       env.DB.prepare('DELETE FROM claims WHERE user_id=?').bind(targetId),
       env.DB.prepare('DELETE FROM account_roles WHERE user_id=?').bind(targetId),
       env.DB.prepare('UPDATE level_overrides SET updated_by=? WHERE updated_by=?').bind(user.id,targetId),
       env.DB.prepare('DELETE FROM users WHERE id=?').bind(targetId)
     ]);
     await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)')
       .bind(crypto.randomUUID(),user.id,'account_deleted',targetId).run();
     return json({ok:true});
   }
   if (path === '/api/admin/roles' && request.method === 'POST') {
     if (role !== 'owner') return json({error:'Owner role required.'},403);
     const data=await body(request), target=String(data.userId||''), next=String(data.role||'');
     if (!['owner','admin','editor','moderator','member'].includes(next)) return json({error:'Invalid role.'},400);
     const exists=await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(target).first();
     if (!exists) return json({error:'User not found.'},404);
     if (target===user.id && next!=='owner') return json({error:'You cannot remove your own owner role.'},400);
     if (next==='member') await env.DB.prepare('DELETE FROM account_roles WHERE user_id=?').bind(target).run();
     else await env.DB.prepare('INSERT INTO account_roles(user_id,role) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role').bind(target,next).run();
     await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'role_'+next,target).run();
     return json({ok:true});
   }

   if (path === '/api/admin/audit' && request.method === 'GET') {
     if(role!=='owner'&&role!=='admin')return json({error:'Admin role required.'},403);
     const rows=await env.DB.prepare('SELECT admin_audit.id,admin_audit.action,admin_audit.target,admin_audit.created_at,users.username AS actor FROM admin_audit LEFT JOIN users ON users.id=admin_audit.actor_id ORDER BY admin_audit.created_at DESC LIMIT 200').all();
     return json({entries:rows.results});
   }
   if (path === '/api/admin/submissions' && request.method === 'GET') {
     if(!canReview)return json({error:'Not permitted.'},403);
     const rows=await env.DB.prepare("SELECT id,leaderboard_username,discord_name,enjoyment,list_type,level_path,percent,video_url,note,created_at FROM record_submissions WHERE status='pending' ORDER BY created_at ASC LIMIT 200").all();
     return json({submissions:rows.results});
   }
   if (path === '/api/admin/submissions/review' && request.method === 'POST') {
     if(!canReview)return json({error:'Not permitted.'},403);
     const data=await body(request);
     const feedback=String(data.feedback||'').trim();if(feedback.length>1000)return json({error:'Feedback too long.'},400);
     if(!['approved','rejected'].includes(data.status)||!/^[0-9a-f-]{36}$/i.test(String(data.id||'')))return json({error:'Invalid review.'},400);
     const submission=await env.DB.prepare("SELECT * FROM record_submissions WHERE id=? AND status='pending'").bind(data.id).first();
     if(!submission)return json({error:'Submission already reviewed.'},409);
     let updatedLevel=null;
     if(data.status==='approved'){
       const override=await env.DB.prepare('SELECT level_json FROM level_overrides WHERE list_type=? AND level_path=?').bind(submission.list_type,submission.level_path).first();
       if(override)updatedLevel=JSON.parse(override.level_json);
       else{
         const levelResponse=await env.ASSETS.fetch(new Request(new URL('/data/'+encodeURIComponent(submission.level_path)+'.json',request.url)));
         if(!levelResponse.ok)return json({error:'Original level data unavailable.'},503);
         updatedLevel=await levelResponse.json();
       }
       if(!Array.isArray(updatedLevel.records))return json({error:'Level records are invalid.'},500);
       const existing=updatedLevel.records.find(x=>String(x.user||'').toLowerCase()===submission.leaderboard_username.toLowerCase());
       if(existing){
         if(Number(existing.percent)<submission.percent){existing.percent=submission.percent;existing.link=submission.video_url;} if(submission.enjoyment!==null)existing.enjoyment=submission.enjoyment;
       }else updatedLevel.records.push({user:submission.leaderboard_username,percent:submission.percent,link:submission.video_url,enjoyment:submission.enjoyment});
       if(updatedLevel.records.length>500)return json({error:'Level has reached the record limit.'},409);
     }
     const statements=[];
     if(updatedLevel)statements.push(env.DB.prepare("INSERT INTO level_overrides(list_type,level_path,level_json,updated_by) VALUES(?,?,?,?) ON CONFLICT(list_type,level_path) DO UPDATE SET level_json=excluded.level_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(submission.list_type,submission.level_path,JSON.stringify(updatedLevel),user.id));
     statements.push(env.DB.prepare("UPDATE record_submissions SET status=?,review_feedback=?,reviewer_id=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(data.status,feedback,user.id,data.id));
     statements.push(env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'record_'+data.status,data.id));
     statements.push(env.DB.prepare('INSERT INTO notifications(id,user_id,kind,message,link) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),submission.user_id,'record','Your '+submission.level_path.replaceAll('_',' ')+' record was '+data.status+'.','/#/submit-record'));
     await env.DB.batch(statements);
     const backup=updatedLevel ? await backupLevelToGitHub(env,submission.list_type,submission.level_path,updatedLevel) : null;
     if(updatedLevel)try{await logLevelChange(env,user.id,submission.list_type,submission.level_path,'record_approved',null,updatedLevel,backup);}catch(e){console.error('History write failed',e);}
     return json({ok:true,githubBackup:backup,note:updatedLevel?'Approved record applied to public list.':'Submission rejected.'});
   }
   if (path === '/api/admin/weekly' && request.method === 'POST') {
     if(!canEdit)return json({error:'Editor role required.'},403);
     const data=await body(request),week=String(data.weekStart||''),type=String(data.listType||''),level=String(data.levelPath||''),title=String(data.title||'').trim(),description=String(data.description||'').trim();
     if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!['normal','platformer'].includes(type)||!/^[A-Za-z0-9_-]{1,120}$/.test(level)||!title||title.length>100||description.length>500)return json({error:'Invalid challenge details.'},400);
     const d=new Date(week+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==week||d.getUTCDay()!==1)return json({error:'Week start must be a Monday.'},400);
     const list=await env.ASSETS.fetch(new Request(new URL('/data/'+(type==='normal'?'_list.json':'_platformer.json'),request.url)));
     if(!list.ok||!(await list.json()).includes(level))return json({error:'Level not found.'},404);
     try{await env.DB.prepare('INSERT INTO weekly_challenges(id,week_start,list_type,level_path,title,description,created_by) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),week,type,level,title,description,user.id).run();}
     catch{return json({error:'A challenge already exists for this week.'},409);}
     await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'weekly_challenge',week).run();
     return json({ok:true});
   }
   if (path === '/api/admin/weekly/entries' && request.method === 'GET') {
     if(!canReview)return json({error:'Not permitted.'},403);
     const rows=await env.DB.prepare("SELECT weekly_challenge_entries.id,weekly_challenge_entries.video_url,weekly_challenge_entries.created_at,weekly_challenges.title,users.username FROM weekly_challenge_entries JOIN weekly_challenges ON weekly_challenges.id=weekly_challenge_entries.challenge_id JOIN users ON users.id=weekly_challenge_entries.user_id WHERE weekly_challenge_entries.status='pending' ORDER BY weekly_challenge_entries.created_at LIMIT 200").all();
     return json({entries:rows.results});
   }
   if (path === '/api/admin/weekly/review' && request.method === 'POST') {
     if(!canReview)return json({error:'Not permitted.'},403);
     const data=await body(request);
     if(!['approved','rejected'].includes(data.status)||!/^[0-9a-f-]{36}$/i.test(String(data.id||'')))return json({error:'Invalid review.'},400);
     const result=await env.DB.prepare("UPDATE weekly_challenge_entries SET status=?,reviewed_by=? WHERE id=? AND status='pending'").bind(data.status,user.id,data.id).run();
     if(!result.meta.changes)return json({error:'Entry already reviewed.'},409);
     await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'weekly_'+data.status,data.id).run();
     const entry=await env.DB.prepare('SELECT user_id FROM weekly_challenge_entries WHERE id=?').bind(data.id).first();
     if(entry)await env.DB.prepare('INSERT INTO notifications(id,user_id,kind,message,link) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),entry.user_id,'weekly','Your weekly challenge entry was '+data.status+'.','/#/community').run();
     return json({ok:true});
   }
   if (path === '/api/admin/rankings/snapshot' && request.method === 'POST') {
     if(!['owner','admin'].includes(role))return json({error:'Admin role required.'},403);
     const data=await body(request),entries=data.entries;
     if(!Array.isArray(entries)||entries.length>1000||!entries.length||!entries.every((e,i)=>e&&/^[A-Za-z0-9_-]{1,32}$/.test(e.user)&&Number.isFinite(e.points)&&e.points>=0&&Number.isInteger(e.rank)&&e.rank===i+1))return json({error:'Invalid ranking snapshot.'},400);
     const day=new Date().toISOString().slice(0,10);
     await env.DB.batch(entries.map(e=>env.DB.prepare("INSERT INTO ranking_snapshots(id,leaderboard_username,points,rank,captured_at) VALUES(?,?,?,?,?) ON CONFLICT(leaderboard_username,captured_at) DO UPDATE SET points=excluded.points,rank=excluded.rank").bind(crypto.randomUUID(),e.user,e.points,e.rank,day)));
     return json({ok:true,count:entries.length});
   }
   if (path === '/api/admin/enjoyment' && request.method === 'GET') {
     if(!canEdit&&!canReview)return json({error:'Not permitted.'},403);
     const listType=String(url.searchParams.get('list')||''),levelPath=String(url.searchParams.get('level')||'');
     if(!['normal','platformer'].includes(listType)||!/^[A-Za-z0-9_-]{1,120}$/.test(levelPath))return json({error:'Invalid level.'},400);
     const listResponse=await env.ASSETS.fetch(new Request(new URL('/data/'+(listType==='normal'?'_list.json':'_platformer.json'),request.url)));
     if(!listResponse.ok||!(await listResponse.json()).includes(levelPath))return json({error:'Level not on this list.'},404);
     const override=await env.DB.prepare('SELECT level_json FROM level_overrides WHERE list_type=? AND level_path=?').bind(listType,levelPath).first();
     let level;
     if(override)level=JSON.parse(override.level_json);
     else {
       const response=await env.ASSETS.fetch(new Request(new URL('/data/'+encodeURIComponent(levelPath)+'.json',request.url)));
       if(!response.ok)return json({error:'Level data unavailable.'},503);
       level=await response.json();
     }
     const manual=await env.DB.prepare('SELECT leaderboard_username,enjoyment FROM manual_enjoyment_ratings WHERE list_type=? AND level_path=?').bind(listType,levelPath).all();
     const byUser=new Map(manual.results.map(x=>[x.leaderboard_username.toLowerCase(),x.enjoyment]));
     const records=(Array.isArray(level.records)?level.records:[]).filter(x=>x&&typeof x.user==='string').map(x=>({username:x.user,enjoyment:byUser.get(x.user.toLowerCase())??(Number.isInteger(x.enjoyment)?x.enjoyment:null),percent:x.percent}));
     return json({records});
   }
   if (path === '/api/admin/enjoyment' && request.method === 'POST') {
     if(!canEdit&&!canReview)return json({error:'Not permitted.'},403);
     const data=await body(request),listType=String(data.listType||''),levelPath=String(data.levelPath||''),username=String(data.username||'').trim(),enjoyment=Number(data.enjoyment);
     if(!['normal','platformer'].includes(listType)||!/^[A-Za-z0-9_-]{1,120}$/.test(levelPath)||!username||username.length>64||!Number.isInteger(enjoyment)||enjoyment<0||enjoyment>10)return json({error:'Select an existing record and a whole-number enjoyment rating (0–10).'},400);
     const listResponse=await env.ASSETS.fetch(new Request(new URL('/data/'+(listType==='normal'?'_list.json':'_platformer.json'),request.url)));
     if(!listResponse.ok||!(await listResponse.json()).includes(levelPath))return json({error:'Level not on this list.'},404);
     const override=await env.DB.prepare('SELECT level_json FROM level_overrides WHERE list_type=? AND level_path=?').bind(listType,levelPath).first();
     let level;
     if(override)level=JSON.parse(override.level_json);
     else {
       const response=await env.ASSETS.fetch(new Request(new URL('/data/'+encodeURIComponent(levelPath)+'.json',request.url)));
       if(!response.ok)return json({error:'Level data unavailable.'},503);
       level=await response.json();
     }
     if(!Array.isArray(level.records))return json({error:'Level has no records.'},400);
     const record=level.records.find(x=>String(x?.user||'').toLowerCase()===username.toLowerCase());
     if(!record)return json({error:'That player does not have a record on this level.'},404);
     record.enjoyment=enjoyment;
     await env.DB.batch([
       env.DB.prepare("INSERT INTO level_overrides(list_type,level_path,level_json,updated_by) VALUES(?,?,?,?) ON CONFLICT(list_type,level_path) DO UPDATE SET level_json=excluded.level_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(listType,levelPath,JSON.stringify(level),user.id),
       env.DB.prepare("INSERT INTO manual_enjoyment_ratings(list_type,level_path,leaderboard_username,enjoyment,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(list_type,level_path,leaderboard_username) DO UPDATE SET enjoyment=excluded.enjoyment,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(listType,levelPath,record.user,enjoyment,user.id),
       env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'enjoyment_edit',listType+':'+levelPath+':'+record.user)
     ]);
     const backup=await backupLevelToGitHub(env,listType,levelPath,level);
     try{await logLevelChange(env,user.id,listType,levelPath,'enjoyment_edit',null,level,backup);}catch(e){console.error('History write failed',e);}
     return json({ok:true,githubBackup:backup});
   }
   if (path === '/api/admin/levels' && request.method === 'POST') {
     if (!canEdit) return json({error:'Level editing not permitted.'},403);
     const data=await body(request), listType=String(data.listType||''), levelPath=String(data.path||'');
     if (!['normal','platformer'].includes(listType) || !/^[A-Za-z0-9_-]{1,120}$/.test(levelPath)) return json({error:'Invalid list or level path.'},400);
     const level=data.level;
     if (!level || typeof level!=='object' || Array.isArray(level) || !Number.isSafeInteger(level.id) || typeof level.name!=='string' || !level.name.trim() || level.name.length>150 || typeof level.author!=='string' || !Array.isArray(level.creators) || !Array.isArray(level.records) || level.records.length>500 || typeof level.verifier!=='string' || !level.records.every(r=>r&&typeof r.user==='string'&&r.user.length<=64&&Number.isFinite(r.percent)&&r.percent>=0&&r.percent<=100)) return json({error:'Invalid level JSON structure.'},400);
     const serialized=JSON.stringify(level);
     if (serialized.length>120000) return json({error:'Level JSON too large.'},413);
     // Prevent editors from creating arbitrary paths: require an existing GitHub-backed list entry.
     const filename=listType==='normal'?'_list.json':'_platformer.json';
     const listResponse=await env.ASSETS.fetch(new Request(new URL('/data/'+filename,request.url)));
     if (!listResponse.ok || !(await listResponse.json()).includes(levelPath)) return json({error:'Level does not exist in this list.'},404);
     const previous=await env.DB.prepare('SELECT level_json FROM level_overrides WHERE list_type=? AND level_path=?').bind(listType,levelPath).first();
     let before=previous?JSON.parse(previous.level_json):null;
     if(!before){const original=await env.ASSETS.fetch(new Request(new URL('/data/'+encodeURIComponent(levelPath)+'.json',request.url)));if(original.ok)before=await original.json();}
     await env.DB.prepare("INSERT INTO level_overrides(list_type,level_path,level_json,updated_by) VALUES(?,?,?,?) ON CONFLICT(list_type,level_path) DO UPDATE SET level_json=excluded.level_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(listType,levelPath,serialized,user.id).run();
     await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'level_edit',listType+':'+levelPath).run();
     const backup=await backupLevelToGitHub(env,listType,levelPath,level);
     try{await logLevelChange(env,user.id,listType,levelPath,'level_edit',before,level,backup);}catch(e){console.error('History write failed',e);}
     return json({ok:true,githubBackup:backup});
   }
   if(path==='/api/admin/levels/bulk'&&request.method==='POST'){
    if(!canEdit)return json({error:'Not permitted.'},403);
    const data=await body(request),type=String(data.listType||''),entries=data.levels;
    if(!['normal','platformer'].includes(type)||!Array.isArray(entries)||entries.length<1||entries.length>30)return json({error:'Select 1–30 levels.'},400);
    const res=await env.ASSETS.fetch(new Request(new URL('/data/'+(type==='normal'?'_list.json':'_platformer.json'),request.url)));
    if(!res.ok)return json({error:'Level list unavailable.'},503);
    const allowed=new Set(await res.json()),seen=new Set(),items=[];
    for(const entry of entries){
     const p=String(entry?.path||''),l=entry?.level;
     if(!/^[A-Za-z0-9_-]{1,120}$/.test(p)||!allowed.has(p)||seen.has(p))return json({error:'Invalid or duplicate level: '+p},400);
     seen.add(p);
     if(!l||typeof l!=='object'||Array.isArray(l)||!Number.isSafeInteger(l.id)||typeof l.name!=='string'||!l.name.trim()||l.name.length>150||typeof l.author!=='string'||!Array.isArray(l.creators)||!Array.isArray(l.records)||l.records.length>500||typeof l.verifier!=='string'||!l.records.every(r=>r&&typeof r.user==='string'&&r.user.length<=64&&Number.isFinite(r.percent)&&r.percent>=0&&r.percent<=100))return json({error:'Invalid JSON for '+p},400);
     const serialized=JSON.stringify(l);if(serialized.length>120000)return json({error:'JSON too large for '+p},413);
     items.push({path:p,level:l,serialized});
    }
    await env.DB.batch(items.flatMap(x=>[
     env.DB.prepare("INSERT INTO level_overrides(list_type,level_path,level_json,updated_by) VALUES(?,?,?,?) ON CONFLICT(list_type,level_path) DO UPDATE SET level_json=excluded.level_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(type,x.path,x.serialized,user.id),
     env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'level_bulk_edit',type+':'+x.path)
    ]));
    const backups=[];
    for(const x of items){
     let backup;try{backup=await backupLevelToGitHub(env,type,x.path,x.level);}catch(e){backup={synced:false,reason:String(e.message||e)};}
     backups.push({path:x.path,...backup});
     try{await logLevelChange(env,user.id,type,x.path,'level_bulk_edit',null,x.level,backup);}catch(e){console.error('History write failed',e);}
    }
    return json({ok:true,saved:items.length,backups});
   }
   if (path === '/api/admin/github-backup/status' && request.method === 'GET') {
     if(!canEdit)return json({error:'Level editing not permitted.'},403);
     const rows=await env.DB.prepare("SELECT o.list_type,o.level_path,o.updated_at,h.github_synced,h.created_at AS last_attempt FROM level_overrides o LEFT JOIN ccl_level_history h ON h.id=(SELECT id FROM ccl_level_history WHERE list_type=o.list_type AND level_path=o.level_path ORDER BY created_at DESC,rowid DESC LIMIT 1) ORDER BY o.updated_at DESC LIMIT 500").all();
     return json({configured:!!env.GITHUB_TOKEN,total:rows.results.length,levels:rows.results.map(x=>({...x,github_synced:x.github_synced===1}))});
   }
   if (path === '/api/admin/github-backup' && request.method === 'POST') {
     if (!canEdit) return json({error:'Level editing not permitted.'},403);
     if (!env.GITHUB_TOKEN) return json({error:'Configure GITHUB_TOKEN as a Cloudflare Worker secret first.'},503);
     const rows=await env.DB.prepare('SELECT list_type,level_path,level_json FROM level_overrides ORDER BY updated_at DESC LIMIT 500').all();
     const results=[];
     for(const row of rows.results){
       let backup;
       try { backup=await backupLevelToGitHub(env,row.list_type,row.level_path,JSON.parse(row.level_json)); }
       catch(e){ backup={synced:false,reason:e.message}; }
       if(backup.synced)try{await env.DB.prepare('UPDATE ccl_level_history SET github_synced=1 WHERE id=(SELECT id FROM ccl_level_history WHERE list_type=? AND level_path=? ORDER BY created_at DESC,rowid DESC LIMIT 1)').bind(row.list_type,row.level_path).run();}catch(e){console.warn('Backup status write failed',e);}
       results.push({listType:row.list_type,path:row.level_path,...backup});
     }
     return json({ok:results.every(x=>x.synced),total:results.length,synced:results.filter(x=>x.synced).length,failed:results.filter(x=>!x.synced)});
   }
   return json({error:'Admin endpoint not found.'},404);
 }
 // Public profile staff badges: only approved claims link leaderboard names to accounts.
 if (path === '/api/profiles/roles' && request.method === 'GET') {
   const username = String(url.searchParams.get('username') || '').trim();
   if (!/^[A-Za-z0-9_-]{1,32}$/.test(username)) return json({role:null});
   const match = await env.DB.prepare(
     "SELECT account_roles.role FROM claims JOIN account_roles ON account_roles.user_id=claims.user_id WHERE claims.status='approved' AND claims.leaderboard_username=? COLLATE NOCASE LIMIT 1"
   ).bind(username).first();
   return json({role:match?.role || null},200,{'cache-control':'public, max-age=60'});
 }

 // Community features require community-migration.sql on the remote D1 database.
 const safeUrl = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && u.hostname.length > 2 && !['localhost','127.0.0.1'].includes(u.hostname); } catch { return false; } };
 const profileOwner = async username => env.DB.prepare("SELECT users.id FROM users JOIN claims ON claims.user_id=users.id WHERE claims.status='approved' AND claims.leaderboard_username=? COLLATE NOCASE LIMIT 1").bind(username).first();
 if (path === '/api/community/profile' && request.method === 'GET') {
   const username=String(url.searchParams.get('username')||'').trim();
   if (!/^[A-Za-z0-9_-]{1,32}$/.test(username)) return json({profile:null});
   const owner=await profileOwner(username);
   if (!owner) return json({profile:null});
   const profile=await env.DB.prepare('SELECT bio,avatar_url,banner_url,accent,favorite_level,featured_badge,showcase_level,background_url FROM player_profiles WHERE user_id=?').bind(owner.id).first();
   return json({profile:profile||null});
 }
 if (path === '/api/community/profile' && request.method === 'POST') {
   const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
   const data=await body(request);
   const bio=String(data.bio||'').trim(),avatar=String(data.avatar_url||'').trim(),banner=String(data.banner_url||'').trim(),accent=String(data.accent||''),favorite=String(data.favorite_level||'').trim(),featured=String(data.featured_badge||'').trim(),showcase=String(data.showcase_level||'').trim(),background=String(data.background_url||'').trim();
   if(bio.length>500 || avatar.length>500 || banner.length>500 || (avatar&&!safeUrl(avatar)) || (banner&&!safeUrl(banner)) || !/^#[0-9a-fA-F]{6}$/.test(accent)||favorite.length>120||featured.length>80||showcase.length>120||background.length>500||(background&&!safeUrl(background)))return json({error:'Invalid profile details.'},400);
   if(favorite){const indexes=await Promise.all(['_list.json','_platformer.json'].map(async file=>{const res=await env.ASSETS.fetch(new Request(new URL('/data/'+file,request.url)));return res.ok?await res.json():[];}));if(!indexes.some(list=>list.includes(favorite)))return json({error:'Favorite must be an existing list level.'},400);}
   await env.DB.prepare("INSERT INTO player_profiles(user_id,bio,avatar_url,banner_url,accent,favorite_level,featured_badge,showcase_level,background_url) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,avatar_url=excluded.avatar_url,banner_url=excluded.banner_url,accent=excluded.accent,favorite_level=excluded.favorite_level,featured_badge=excluded.featured_badge,showcase_level=excluded.showcase_level,background_url=excluded.background_url,updated_at=CURRENT_TIMESTAMP").bind(user.id,bio,avatar,banner,accent,favorite,featured,showcase,background).run();
   return json({ok:true});
 }
 if (path === '/api/community/enjoyment' && request.method === 'GET') {
   const rows=await env.DB.prepare("SELECT list_type,level_path,ROUND(AVG(enjoyment),2) AS average,COUNT(*) AS ratings FROM (SELECT list_type,level_path,leaderboard_username,enjoyment FROM manual_enjoyment_ratings UNION ALL SELECT s.list_type,s.level_path,s.leaderboard_username,s.enjoyment FROM record_submissions s WHERE s.status='approved' AND s.enjoyment IS NOT NULL AND s.id=(SELECT t.id FROM record_submissions t WHERE t.status='approved' AND t.list_type=s.list_type AND t.level_path=s.level_path AND t.leaderboard_username=s.leaderboard_username COLLATE NOCASE ORDER BY t.reviewed_at DESC,t.created_at DESC,t.id DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM manual_enjoyment_ratings m WHERE m.list_type=s.list_type AND m.level_path=s.level_path AND m.leaderboard_username=s.leaderboard_username COLLATE NOCASE)) GROUP BY list_type,level_path ORDER BY average DESC,ratings DESC,level_path LIMIT 300").all();
   return json({levels:rows.results});
 }
 if (path === '/api/community/player-stats' && request.method === 'GET') {
   const username=String(url.searchParams.get('username')||'').trim();
   if(!/^[A-Za-z0-9_-]{1,32}$/.test(username))return json({stats:null});
   const stats=await env.DB.prepare("SELECT COUNT(*) AS approved_records,ROUND(AVG(enjoyment),2) AS average_enjoyment,MAX(percent) AS best_percent FROM record_submissions WHERE leaderboard_username=? COLLATE NOCASE AND status='approved'").bind(username).first();
   const recent=await env.DB.prepare("SELECT list_type,level_path,percent,enjoyment,reviewed_at FROM record_submissions WHERE leaderboard_username=? COLLATE NOCASE AND status='approved' ORDER BY reviewed_at DESC LIMIT 6").bind(username).all();
   return json({stats,recent:recent.results});
 }
 if (path === '/api/community/submissions' && request.method === 'GET') {
   const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
   const rows=await env.DB.prepare('SELECT id,leaderboard_username,list_type,level_path,percent,video_url,status,created_at,reviewed_at,review_feedback FROM record_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all();
   return json({submissions:rows.results});
 }
 if(path==='/api/community/submissions/bulk'&&request.method==='POST'){
  const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
  const claim=await env.DB.prepare("SELECT leaderboard_username FROM claims WHERE user_id=? AND status='approved' LIMIT 1").bind(user.id).first();
  if(!claim)return json({error:'Approved player profile claim required.'},403);
  const data=await body(request),records=data.records;
  if(!Array.isArray(records)||records.length<1||records.length>20)return json({error:'Submit 1–20 records.'},400);
  const seen=new Set(),validated=[],lists={};
  for(let i=0;i<records.length;i++){
   const x=records[i]||{},type=String(x.listType||''),level=String(x.levelPath||''),video=String(x.videoUrl||'').trim(),percent=Number(x.percent),enjoyment=Number(x.enjoyment),discord=String(x.discordName||'').trim(),username=String(x.username||'').trim();
   const label='Record '+(i+1)+': ';
   if(!['normal','platformer'].includes(type)||!/^[A-Za-z0-9_-]{1,120}$/.test(level))return json({error:label+'Invalid list or level.'},400);
   if(seen.has(type+':'+level))return json({error:label+'Duplicate level.'},400);seen.add(type+':'+level);
   if(!Number.isInteger(percent)||percent<1||percent>100)return json({error:label+'Percentage must be 1–100.'},400);
   if(!safeUrl(video)||video.length>500)return json({error:label+'Valid HTTPS proof link required.'},400);
   if(!Number.isInteger(enjoyment)||enjoyment<0||enjoyment>10)return json({error:label+'Enjoyment must be 0–10.'},400);
   if(username.toLowerCase()!==claim.leaderboard_username.toLowerCase())return json({error:label+'Username does not match your profile.'},400);
   if(discord.length<2||discord.length>64||[...discord].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return json({error:label+'Invalid Discord username.'},400);
   if(!lists[type]){const response=await env.ASSETS.fetch(new Request(new URL('/data/'+(type==='normal'?'_list.json':'_platformer.json'),request.url)));if(!response.ok)return json({error:'List unavailable.'},503);lists[type]=new Set(await response.json());}
   if(!lists[type].has(level))return json({error:label+'Level not on selected list.'},404);
   validated.push({type,level,video,percent,enjoyment,discord,username});
  }
  for(const x of validated){const existing=await env.DB.prepare("SELECT id FROM record_submissions WHERE user_id=? AND list_type=? AND level_path=? AND status='pending'").bind(user.id,x.type,x.level).first();if(existing)return json({error:'Already pending: '+x.level},409);}
  await env.DB.batch(validated.map(x=>env.DB.prepare('INSERT INTO record_submissions(id,user_id,leaderboard_username,list_type,level_path,percent,video_url,note,discord_name,enjoyment) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),user.id,x.username,x.type,x.level,x.percent,x.video,'',x.discord,x.enjoyment)));
  return json({ok:true,submitted:validated.length},201);
 }
 if (path === '/api/community/submissions' && request.method === 'POST') {
   const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
   const claim=await env.DB.prepare("SELECT leaderboard_username FROM claims WHERE user_id=? AND status='approved' LIMIT 1").bind(user.id).first();
   if(!claim)return json({error:'You need an approved leaderboard profile claim to submit records.'},403);
   const data=await body(request),type=String(data.listType||''),level=String(data.levelPath||''),video=String(data.videoUrl||''),percent=Number(data.percent),note=String(data.note||'').trim(),username=String(data.username||'').trim(),discord=String(data.discordName||'').trim(),enjoyment=Number(data.enjoyment);
if(!['normal','platformer'].includes(type))return json({error:'Select a valid list.'},400);
   if(!/^[A-Za-z0-9_-]{1,120}$/.test(level))return json({error:'Select a valid level.'},400);
   if(!Number.isInteger(percent)||percent<1||percent>100)return json({error:'Completion percentage must be a whole number from 1 to 100.'},400);
   if(!safeUrl(video)||video.length>500)return json({error:'Enter a valid public HTTPS video proof link (500 characters maximum).'},400);
   if(note.length>500)return json({error:'Submission note is too long.'},400);
   if(username.toLowerCase()!==claim.leaderboard_username.toLowerCase())return json({error:'CCL username must match your approved profile: '+claim.leaderboard_username},400);
   if(discord.length<2||discord.length>64||[...discord].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))return json({error:'Discord username must be between 2 and 64 characters and contain no control characters.'},400);
   if(!Number.isInteger(enjoyment)||enjoyment<0||enjoyment>10)return json({error:'Enjoyment must be a whole number between 0 and 10.'},400);
   const listResponse=await env.ASSETS.fetch(new Request(new URL('/data/'+(type==='normal'?'_list.json':'_platformer.json'),request.url)));
   if(!listResponse.ok||!(await listResponse.json()).includes(level))return json({error:'Level not found on selected list.'},404);
   const existing=await env.DB.prepare("SELECT id FROM record_submissions WHERE user_id=? AND list_type=? AND level_path=? AND status='pending'").bind(user.id,type,level).first();
   if(existing)return json({error:'You already have a pending submission for this level.'},409);
   await env.DB.prepare('INSERT INTO record_submissions(id,user_id,leaderboard_username,list_type,level_path,percent,video_url,note,discord_name,enjoyment) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),user.id,claim.leaderboard_username,type,level,percent,video,note,discord,enjoyment).run();
   return json({ok:true},201);
 }
 if (path === '/api/community/weekly' && request.method === 'GET') {
   const rows=await env.DB.prepare("SELECT id,week_start,list_type,level_path,title,description FROM weekly_challenges ORDER BY week_start DESC LIMIT 12").all();
   const winners=await env.DB.prepare("SELECT weekly_challenge_entries.challenge_id,users.username FROM weekly_challenge_entries JOIN users ON users.id=weekly_challenge_entries.user_id WHERE weekly_challenge_entries.status='approved' ORDER BY weekly_challenge_entries.created_at ASC LIMIT 500").all();
   return json({challenges:rows.results,completions:winners.results});
 }
 if (path === '/api/community/weekly/enter' && request.method === 'POST') {
   const user=await currentUser(request,env.DB);if(!user)return json({error:'Log in first.'},401);
   const claim=await env.DB.prepare("SELECT id FROM claims WHERE user_id=? AND status='approved' LIMIT 1").bind(user.id).first();
   if(!claim)return json({error:'An approved player claim is required.'},403);
   const data=await body(request),video=String(data.videoUrl||'').trim(),challengeId=String(data.challengeId||'');
   if(!safeUrl(video)||video.length>500)return json({error:'Enter a valid video URL.'},400);
   const challenge=await env.DB.prepare('SELECT week_start FROM weekly_challenges WHERE id=?').bind(challengeId).first();
   if(!challenge)return json({error:'Challenge not found.'},404);
   const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
   if(challenge.week_start!==monday.toISOString().slice(0,10))return json({error:'This challenge is no longer active.'},409);
   try {await env.DB.prepare('INSERT INTO weekly_challenge_entries(id,challenge_id,user_id,video_url) VALUES(?,?,?,?)').bind(crypto.randomUUID(),challengeId,user.id,video).run();}
   catch{return json({error:'You already entered this challenge.'},409);}
   return json({ok:true},201);
 }
 if (path === '/api/community/history' && request.method === 'GET') {
   const name=String(url.searchParams.get('username')||'');
   if(!/^[A-Za-z0-9_-]{1,32}$/.test(name))return json({history:[]});
   const rows=await env.DB.prepare('SELECT points,rank,captured_at FROM ranking_snapshots WHERE leaderboard_username=? COLLATE NOCASE ORDER BY captured_at DESC LIMIT 90').bind(name).all();
   return json({history:rows.results.reverse()});
 }
 if (path === '/api/levels/overrides' && request.method === 'GET') {
   const listType=url.searchParams.get('list');
   if (!['normal','platformer'].includes(listType)) return json({error:'Invalid list.'},400);
   const rows=await env.DB.prepare('SELECT level_path,level_json FROM level_overrides WHERE list_type=?').bind(listType).all();
   const levels=Object.create(null);
   for (const row of rows.results) { try { levels[row.level_path]=JSON.parse(row.level_json); } catch(e) { console.error('Invalid override',row.level_path,e); } }
   return json({levels});
 }
 return json({ error:'Not found' }, 404);
}
export default { async fetch(request, env) { try { return await handle(request,env); } catch(e) { console.error(e); return json({ error:'Service temporarily unavailable.' },500); } } };
