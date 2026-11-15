const STATES = ['Inbox', 'Planned', 'In Progress', 'Done', 'Not Planned'];
const encoder = new TextEncoder();
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json = (value,status=200,extra={}) => new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
const err = (message,status=400,extra={}) => json({error:message},status,extra);
const bytes = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const safeEq = (a,b) => { if(a.length!==b.length)return false; let diff=0; for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; };
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const hostAllowed = host => host === 'shauryaswebsites.com' || host.endsWith('.shauryaswebsites.com') || host === 'localhost' || host === '127.0.0.1';
function trustedOrigin(value, requestUrl) {
  if(!value) return null;
  try {
    const origin = new URL(value);
    const page = new URL(requestUrl);
    if(!['https:','http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash) return null;
    if(!hostAllowed(origin.hostname))return null;
    if(['localhost','127.0.0.1'].includes(origin.hostname) && !['localhost','127.0.0.1'].includes(page.hostname))return null;
    if(origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname))return null;
    return origin.origin;
  } catch { return null; }
}
function cors(origin) { return origin ? {'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, PATCH, OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'3600','vary':'Origin'} : {}; }
async function sign(data,secret) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(data))));
}
async function admin(request,env) {
  if(!env.SESSION_SECRET || !env.ADMIN_PASSCODE)return false;
  const cookie = request.headers.get('cookie')||'';
  const token = cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('feedback_session='))?.slice(17);
  if(!token)return false;
  const parts=token.split('.');
  if(parts.length!==3)return false;
  const [ts,nonce,mac]=parts;
  if(!/^\d{10,13}$/.test(ts)|| !/^[a-zA-Z0-9_-]{16,64}$/.test(nonce))return false;
  const age=Date.now()-Number(ts);
  if(age<0||age>8*60*60*1000)return false;
  const passHash=hex(await bytes(env.ADMIN_PASSCODE));
  const expected=await sign(ts+'.'+nonce+'.'+passHash,env.SESSION_SECRET);
  return safeEq(expected,mac);
}
function sameOrigin(request) {
  const origin=request.headers.get('origin');
  return !!origin && origin===new URL(request.url).origin;
}
async function checkThrottle(env,key,prefix) {
  const now=Date.now();
  const hashed=hex(await bytes((env.SESSION_SECRET||'')+':'+prefix+':'+key));
  // Atomic conditional upsert: blocked attempts do not increase the counter.
  const result=await env.DB.prepare(`INSERT INTO rate_limits (key,count,next_allowed,window_start)
    VALUES (?,1,?+2000,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN ?-window_start > 86400000 THEN 1 ELSE MIN(count+1,16) END,
      next_allowed=? + CASE WHEN ?-window_start > 86400000 THEN 2000 ELSE MIN(3600000, 1000 * (1 << MIN(count+1,12))) END,
      window_start=CASE WHEN ?-window_start > 86400000 THEN ? ELSE window_start END
    WHERE next_allowed <= ?
    RETURNING count,next_allowed`).bind(hashed,now,now,now,now,now,now,now,now).first();
  if(!result)return false;
  return true;
}
function ip(request) { return request.headers.get('cf-connecting-ip') || 'unknown'; }
async function api(request,env,url) {
  const path=url.pathname;
  const origin=trustedOrigin(request.headers.get('origin'),request.url);
  const ch=cors(origin);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:ch});
  if(!env.DB)return err('Database not configured',503,ch);
  if(path==='/api/feedback' && request.method==='GET') {
    const isAdmin=await admin(request,env);
    const sql=isAdmin ? 'SELECT id,message,email,site,status,created_at,updated_at FROM feedback ORDER BY created_at DESC LIMIT 500' : 'SELECT id,message,site,status,created_at,updated_at FROM feedback ORDER BY created_at DESC LIMIT 500';
    const rows=await env.DB.prepare(sql).all();
    return json({items:rows.results||[],admin:isAdmin},200,ch);
  }
  if(path==='/api/feedback' && request.method==='POST') {
    if(!origin)return err('Submissions are only accepted from Shaurya websites',403,ch);
    if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return err('Expected JSON',415,ch);
    if(Number(request.headers.get('content-length')||0)>10000)return err('Request too large',413,ch);
    let body;
    try { body=await request.json(); } catch { return err('Invalid JSON',400,ch); }
    if(!body||typeof body!=='object'||Array.isArray(body))return err('Invalid submission',400,ch);
    if(body.website || body.company)return json({ok:true},202,ch); // honeypot
    const message=String(body.message||'').trim(), email=String(body.email||'').trim();
    if(message.length<3||message.length>2000)return err('Message must be 3–2000 characters',400,ch);
    if(email.length>254||!/^[-.!#$%&'*+/=?^_`{|}~\w]+@[-\w]+(?:\.[-\w]+)+$/.test(email))return err('Enter a valid email',400,ch);
    const allowed=await checkThrottle(env,ip(request)+':'+origin,'feedback');
    if(!allowed)return err('Please wait before sending another suggestion',429,{...ch,'retry-after':'30'});
    const id=crypto.randomUUID(), now=new Date().toISOString(),site=new URL(origin).hostname;
    await env.DB.prepare('INSERT INTO feedback(id,message,email,site,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,message,email,site,'Inbox',now,now).run();
    return json({ok:true,id},201,ch);
  }
  if(path==='/api/admin/login' && request.method==='POST') {
    if(!sameOrigin(request))return err('Forbidden',403);
    if(!env.ADMIN_PASSCODE||!env.SESSION_SECRET)return err('Admin secrets not configured',503);
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))return err('Expected JSON',415);
    const allowed=await checkThrottle(env,ip(request),'login');
    if(!allowed)return err('Too many attempts. Try later.',429,{'retry-after':'30'});
    let body;try{body=await request.json();}catch{return err('Invalid JSON');}
    const proposed=typeof body?.passcode==='string'?body.passcode:'';
    if(proposed.length>1024)return err('Invalid passcode',401);
    const a=hex(await bytes(proposed)),b=hex(await bytes(env.ADMIN_PASSCODE));
    if(!safeEq(a,b))return err('Incorrect passcode',401);
    const ts=String(Date.now()),nonce=b64(crypto.getRandomValues(new Uint8Array(24)));
    const mac=await sign(ts+'.'+nonce+'.'+b,env.SESSION_SECRET);
    return json({ok:true},200,{'set-cookie':`feedback_session=${ts}.${nonce}.${mac}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});
  }
  if(path==='/api/admin/logout' && request.method==='POST') {
    if(!sameOrigin(request))return err('Forbidden',403);
    return json({ok:true},200,{'set-cookie':'feedback_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
  }
  const match=path.match(/^\/api\/feedback\/([0-9a-f-]{36})$/);
  if(match&&request.method==='PATCH') {
    if(!sameOrigin(request)||!await admin(request,env))return err('Unauthorized',401);
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))return err('Expected JSON',415);
    let body;try{body=await request.json();}catch{return err('Invalid JSON');}
    if(!STATES.includes(body?.status))return err('Invalid status');
    const result=await env.DB.prepare('UPDATE feedback SET status=?,updated_at=? WHERE id=?').bind(body.status,new Date().toISOString(),match[1]).run();
    return result.meta.changes ? json({ok:true}) : err('Not found',404);
  }
  return err('Not found',404,ch);
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    try {
      if(url.pathname.startsWith('/api/'))return await api(request,env,url);
      return env.ASSETS.fetch(request);
    } catch(e) {
      console.error('Feedback worker failed',e?.message);
      return err('Something went wrong',500);
    }
  }
};
