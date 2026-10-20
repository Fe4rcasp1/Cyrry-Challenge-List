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
     statements.push(env.DB.prepare("UPDATE record_submissions SET status=?,reviewer_id=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(data.status,user.id,data.id));
     statements.push(env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'record_'+data.status,data.id));
     statements.push(env.DB.prepare('INSERT INTO notifications(id,user_id,kind,message,link) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),submission.user_id,'record','Your '+submission.level_path.replaceAll('_',' ')+' record was '+data.status+'.','/#/submit-record'));
     await env.DB.batch(statements);
     return json({ok:true,note:updatedLevel?'Approved record applied to public list.':'Submission rejected.'});
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
     return json({ok:true});
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
     await env.DB.prepare("INSERT INTO level_overrides(list_type,level_path,level_json,updated_by) VALUES(?,?,?,?) ON CONFLICT(list_type,level_path) DO UPDATE SET level_json=excluded.level_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(listType,levelPath,serialized,user.id).run();
     await env.DB.prepare('INSERT INTO admin_audit(id,actor_id,action,target) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'level_edit',listType+':'+levelPath).run();
     return json({ok:true});
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
   const rows=await env.DB.prepare('SELECT id,leaderboard_username,list_type,level_path,percent,video_url,status,created_at FROM record_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all();
   return json({submissions:rows.results});
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
