const STATES=['Inbox','Planned','In Progress','Done','Not Planned'];
const STATUS_LABELS={'Inbox':'New Feedback','Planned':'Backlog','Done':'Available in Production','Not Planned':'Will Not Do'};
const statusLabel=status=>STATUS_LABELS[status]||status;
const $=id=>document.getElementById(id);
let isAdmin=false;
const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
async function request(path,opts={}){const res=await fetch(path,{credentials:'same-origin',...opts});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'Request failed');return data;}
function openDialog(id){$(id).showModal();}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('suggestBtn').onclick=()=>openDialog('ideaDialog');
$('refreshBtn').onclick=()=>load();
$('ideaForm').onsubmit=async e=>{
 e.preventDefault(); const btn=e.target.querySelector('[type=submit]');btn.disabled=true;$('ideaError').textContent='';
 try{await request('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:$('message').value,email:$('email').value,website:e.target.elements.website.value})});$('ideaForm').reset();$('ideaDialog').close();await load();}catch(err){$('ideaError').textContent=err.message;}finally{btn.disabled=false;}
};
async function update(id,status){try{await request('/api/feedback/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status})});await load();}catch(e){alert(e.message);await load();}}
async function load(){
 try{
  const data=await request('/api/feedback');isAdmin=data.admin === true;
  $('count').textContent=data.items.length+' idea'+(data.items.length===1?'':'s')+' shared';
  const board=$('board');board.replaceChildren();
  STATES.forEach((state,index)=>{
   const col=make('section','column');const heading=make('div','colhead');const title=make('h3','',statusLabel(state));const count=make('span','pill',String(data.items.filter(i=>i.status===state).length));heading.append(title,count);col.append(heading);
   const list=make('div','cards');list.dataset.status=state;
   if(isAdmin){list.ondragover=e=>{e.preventDefault();list.classList.add('over');};list.ondragleave=()=>list.classList.remove('over');list.ondrop=e=>{e.preventDefault();list.classList.remove('over');const id=e.dataTransfer.getData('text/plain');if(id)update(id,state);};}
   const items=data.items.filter(i=>i.status===state);
   items.forEach(item=>{
    const card=make('article','feedback-card');
    if(isAdmin){card.draggable=true;card.ondragstart=e=>e.dataTransfer.setData('text/plain',item.id);}
    card.append(make('p','message',item.message));
    const meta=make('div','card-meta');meta.append(make('span','site',item.site.replace('.shauryaswebsites.com','')));
    const date=new Date(item.created_at);meta.append(make('time','',isNaN(date)?'':date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})));card.append(meta);
    if(isAdmin){
     card.append(make('p','email',item.email||''));
     const select=make('select','status');select.setAttribute('aria-label','Change feedback status');STATES.forEach(s=>{const op=make('option','',statusLabel(s));op.value=s;op.selected=s===item.status;select.append(op);});select.onchange=()=>update(item.id,select.value);card.append(select);
    }
    list.append(card);
   });
   if(!items.length)list.append(make('div','empty',index===0?'Be the first to share an idea ✨':'Nothing here yet'));
   col.append(list);board.append(col);
  });
 }catch(e){$('count').textContent='Could not load the board: '+e.message;}
}
window.addEventListener('shaurya:auth-changed',()=>load());
window.addEventListener('focus',()=>load());
load();