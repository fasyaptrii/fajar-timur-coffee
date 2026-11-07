const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const rp=n=>'Rp '+Number(n||0).toLocaleString('id-ID');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fdt=s=>s?new Date(s.replace(' ','T')+'Z').toLocaleString('id-ID',{timeZone:'Asia/Jayapura',dateStyle:'medium',timeStyle:'short'})+' WIT':'-';
const ST={menunggu:'Menunggu',diterima:'Diterima',diproses:'Diproses',selesai:'Selesai',dibatalkan:'Dibatalkan'};
async function api(p,o={}){
  const r=await fetch(p,{method:o.method||'GET',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:o.body?JSON.stringify(o.body):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401&&/^\/api\/(staff|admin|owner|me)/.test(p))location.replace('/login.html?expired=1');throw Object.assign(new Error(j.error||'Terjadi kesalahan. Coba lagi.'),{status:r.status})}
  return j;
}
function toast(m){const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),3200)}
