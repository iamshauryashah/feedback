export { FeedbackStore } from './feedback-store.js';
const STATES = ['Inbox', 'Planned', 'In Progress', 'Done', 'Not Planned'];
const encoder = new TextEncoder();
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json = (value,status=200,extra={}) => new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
const err = (message,status=400,extra={}) => json({error:message},status,extra);
const bytes = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const TRUSTED_DOMAINS = ['shauryaswebsites.com', 'shauryaswebsite.com'];
const hostAllowed = host => TRUSTED_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain)) || host === 'localhost' || host === '127.0.0.1';
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
// Check the authoritative Better Auth session and server-owned admin role.
// Use a Worker service binding; never trust an isAdmin value supplied by the browser.
async function platformAdmin(request,env) {
  if (!env.AUTH_SERVICE) throw new Error('Identity service binding is missing');
  const cookie = request.headers.get('cookie') || '';
  if (!cookie) return false;
  const response = await env.AUTH_SERVICE.fetch(new Request('https://auth.shauryaswebsites.com/api/me', {
    method: 'GET',
    headers: { 'cookie': cookie, 'accept': 'application/json' },
    redirect: 'manual'
  }));
  if (!response.ok) throw new Error('Identity service unavailable');
  const profile = await response.json();
  return profile?.isAdmin === true && profile?.userType === 'admin';
}
function sameOrigin(request) {
  const origin=request.headers.get('origin');
  return !!origin && origin===new URL(request.url).origin;
}
function storage(env) {
  return env.FEEDBACK_STORE.get(env.FEEDBACK_STORE.idFromName('global'));
}
async function store(env, route, data) {
  const response = await storage(env).fetch('https://feedback-store.internal/' + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Feedback storage unavailable');
  return result;
}
async function checkThrottle(env, key, prefix) {
  const hashed = hex(await bytes((env.SESSION_SECRET || '') + ':' + prefix + ':' + key));
  return store(env, 'throttle', {key:hashed, now:Date.now()});
}
function ip(request) { return request.headers.get('cf-connecting-ip') || 'unknown'; }
async function api(request,env,url) {
  const path=url.pathname;
  const origin=trustedOrigin(request.headers.get('origin'),request.url);
  const ch=cors(origin);
  if(request.method==='OPTIONS')return origin ? new Response(null,{status:204,headers:ch}) : err('Origin not allowed',403);
  if(!env.FEEDBACK_STORE)return err('Feedback store not configured',503,ch);
  if(path==='/api/feedback' && request.method==='GET') {
    let isAdmin = false;
    try { isAdmin = await platformAdmin(request,env); }
    catch (e) { console.warn('Identity lookup unavailable: showing public board',e.message); }
    const rows=await store(env,'list',{admin:isAdmin});
    return json({items:rows.items,admin:isAdmin},200,ch);
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
    const throttle=await checkThrottle(env,ip(request)+':'+origin,'feedback');
    if(!throttle.allowed)return err('Please wait before sending another suggestion',429,{...ch,'retry-after':String(throttle.retryAfter)});
    const id=crypto.randomUUID(), now=new Date().toISOString(),site=new URL(origin).hostname;
    await store(env,'submit',{id,message,email,site,now});
    return json({ok:true,id},201,ch);
  }
  const match=path.match(/^\/api\/feedback\/([0-9a-f-]{36})$/);
  if(match&&request.method==='PATCH') {
    if(!sameOrigin(request))return err('Forbidden',403);
    if(!env.AUTH_SERVICE)return err('Identity service unavailable',503);
    let isAdmin;
    try { isAdmin=await platformAdmin(request,env); }
    catch { return err('Identity service unavailable',503); }
    if(!isAdmin)return err('Administrator access required',403);
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))return err('Expected JSON',415);
    let body;try{body=await request.json();}catch{return err('Invalid JSON');}
    if(!STATES.includes(body?.status))return err('Invalid status');
    const response = await storage(env).fetch('https://feedback-store.internal/update', {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({id:match[1],status:body.status,now:new Date().toISOString()})
    });
    return json(await response.json(),response.status);
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
