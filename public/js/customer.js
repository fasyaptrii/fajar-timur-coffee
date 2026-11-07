(async()=>{
const qs=new URLSearchParams(location.search);let tb=null,M=qs.get('meja')||sessionStorage.getItem('ft_m'),K=qs.get('k')||sessionStorage.getItem('ft_k');
try{tb=await api(`/api/table?meja=${encodeURIComponent(M)}&k=${encodeURIComponent(K)}`);sessionStorage.setItem('ft_m',M);sessionStorage.setItem('ft_k',K)}catch{}
$('#tbl').textContent=tb?'Meja '+tb.number:'Meja belum terbaca — scan ulang QR di meja Anda';
const sk=io(),cart=new Map();let data={categories:[]},cat=0,nm='',pm='qris',cur=localStorage.getItem('ft_order'),qr=null;
const all=()=>data.categories.flatMap(c=>c.items),sum=()=>[...cart.values()].reduce((a,l)=>a+l.price*l.qty,0),cnt=()=>[...cart.values()].reduce((a,l)=>a+l.qty,0);
const stepper=i=>`<span class="step"><button data-sub="${i.id}" aria-label="Kurangi ${esc(i.name)}">−</button><b>${cart.get(i.id)?.qty||0}</b><button data-add="${i.id}" aria-label="Tambah ${esc(i.name)}">+</button></span>`;
function drawMenu(){
  $('#cats').innerHTML=[['Semua',0],...data.categories.map(c=>[c.name,c.id])].map(([n,id])=>`<button data-cat="${id}" class="${cat===id?'on':''}">${esc(n)}</button>`).join('');
  $('#menu').innerHTML=data.categories.filter(c=>!cat||c.id===cat).map(c=>`<h2 class="cat">${esc(c.name)}</h2>`+c.items.map(i=>`<div class="item"><div><b>${esc(i.name)}</b>${i.description?`<small>${esc(i.description)}</small>`:''}<span class="p">${rp(i.price)}</span></div>${stepper(i)}</div>`).join('')).join('')||'<p class="muted">Menu belum tersedia.</p>';
  $('#cartbar').classList.toggle('hidden',!cnt());$('#openCart').textContent=`Lihat pesanan · ${cnt()} item · ${rp(sum())}`;
}
function change(id,d){const i=all().find(x=>x.id===id);if(!i)return;const l=cart.get(id)||{...i,qty:0,note:''};l.qty+=d;l.qty<=0?cart.delete(id):cart.set(id,l);drawMenu();if(!$('#sheet').classList.contains('hidden'))drawSheet()}
async function drawSheet(msg=''){
  if(!cnt()){$('#sheet').classList.add('hidden');return}
  $('#sheetBody').innerHTML=`<h2>Pesanan Anda</h2><p class="muted">${tb?'Meja '+tb.number:'Meja belum terbaca'}</p>${msg?`<div class="err" role="alert">${esc(msg)}</div>`:''}
  ${[...cart.values()].map(l=>`<div class="item"><div><b>${esc(l.name)}</b><span class="p">${rp(l.price*l.qty)}</span><input data-note="${l.id}" placeholder="Catatan (mis. less sugar)" maxlength="120" value="${esc(l.note)}" style="margin-top:.3rem"></div>${stepper(l)}</div>`).join('')}
  <div id="recs"></div><label for="nm">Nama (opsional)</label><input id="nm" maxlength="40" value="${esc(nm)}">
  <label>Pembayaran</label><div class="row"><label class="card" style="margin:0"><input type="radio" name="pm" value="qris" ${pm==='qris'?'checked':''} style="width:auto"> QRIS</label><label class="card" style="margin:0"><input type="radio" name="pm" value="tunai" ${pm==='tunai'?'checked':''} style="width:auto"> Tunai di kasir</label></div>
  <p><b>Total ${rp(sum())}</b></p><button id="send" class="btn coral" style="width:100%">Kirim pesanan</button> <button id="closeSheet" class="btn ghost" style="width:100%;margin-top:.5rem">Kembali ke menu</button>`;
  $('#sheet').classList.remove('hidden');
  try{const r=await api('/api/recommend',{method:'POST',body:{ids:[...cart.keys()]}});if(r.length&&$('#recs'))$('#recs').innerHTML=`<h3 style="margin-top:1rem">${r[0].reason==='bersama'?'Sering dipesan bersamaan':'Menu terlaris'}</h3><div class="rec">${r.map(x=>`<div class="card"><b>${esc(x.name)}</b><br>${rp(x.price)}<br><button class="btn sm" data-add="${x.id}" style="margin-top:.4rem">Tambah</button></div>`).join('')}</div>`}catch{}
}
const STEPS=['menunggu','diterima','diproses','selesai'];
function drawTrack(o){
  const ix=STEPS.indexOf(o.status),paid=o.payment_status==='lunas';
  $('#trackBody').innerHTML=`<h2>Pesanan ${esc(o.code)}</h2><p class="muted">Meja ${o.table_number} · ${esc(o.customer_name)}</p>
  ${o.status==='dibatalkan'?'<div class="err">Pesanan dibatalkan.</div>':`<div class="tl" aria-label="Status pesanan">${STEPS.map((s,i)=>`<div class="${i<=ix?'on':''}">${ST[s]}</div>`).join('')}</div>`}
  <p>Pembayaran: <span class="badge ${paid?'ok':'warn'}">${paid?'Lunas':'Belum dibayar'}</span> (${o.payment_method==='qris'?'QRIS':'Tunai'})</p>
  ${!paid&&o.payment_method==='tunai'?'<div class="card">Silakan bayar tunai ke kasir. Status akan berubah otomatis setelah dikonfirmasi.</div>':''}
  ${!paid&&o.payment_method==='qris'&&o.status!=='dibatalkan'?(qr?`<div class="card qrbox"><img src="${qr.image}" alt="Kode QRIS pembayaran"><p><b>${rp(qr.total)}</b><br><span class="muted">Scan dengan aplikasi pembayaran Anda. Status berubah otomatis.</span></p>${qr.simulation?'<button id="sim" class="btn ghost sm">Simulasikan pembayaran (mode uji)</button>':''}</div>`:'<button id="qris" class="btn coral" style="width:100%">Tampilkan QRIS</button>'):''}
  <table style="margin:.8rem 0">${o.items.map(i=>`<tr><td>${i.qty}× ${esc(i.name)}${i.note?`<br><span class="muted">${esc(i.note)}</span>`:''}</td><td>${rp(i.price*i.qty)}</td></tr>`).join('')}<tr><th>Total</th><th>${rp(o.total)}</th></tr></table>
  ${paid?`<a class="btn" href="/invoice.html?code=${esc(o.code)}" target="_blank" rel="noopener">Lihat invoice</a> `:''}<button id="again" class="btn ghost">${o.status==='selesai'||o.status==='dibatalkan'?'Pesan lagi':'Tambah pesanan baru'}</button>`;
  $('#track').classList.remove('hidden');
}
async function load(code){try{const o=await api('/api/orders/'+code);drawTrack(o)}catch{localStorage.removeItem('ft_order');cur=null}}
document.addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.cat!==undefined){cat=+t.dataset.cat;drawMenu()}
  else if(t.dataset.add)change(+t.dataset.add,1);else if(t.dataset.sub)change(+t.dataset.sub,-1);
  else if(t.id==='openCart')drawSheet();else if(t.id==='closeSheet')$('#sheet').classList.add('hidden');
  else if(t.id==='send'){
    t.disabled=true;
    try{const r=await api('/api/orders',{method:'POST',body:{meja:M,k:K,customer_name:nm,payment_method:pm,items:[...cart.values()].map(l=>({id:l.id,qty:l.qty,note:l.note}))}});
      cart.clear();qr=null;cur=r.code;localStorage.setItem('ft_order',cur);sk.emit('track',cur);$('#sheet').classList.add('hidden');drawMenu();await load(cur)}
    catch(x){drawSheet(x.message)}}
  else if(t.id==='qris'){t.disabled=true;try{qr=await api(`/api/orders/${cur}/qris`,{method:'POST'});load(cur)}catch(x){toast(x.message);t.disabled=false}}
  else if(t.id==='sim'){await api(`/api/orders/${cur}/simulate-pay`,{method:'POST'})}
  else if(t.id==='again'){$('#track').classList.add('hidden')}
});
document.addEventListener('input',e=>{if(e.target.id==='nm')nm=e.target.value;if(e.target.dataset.note){const l=cart.get(+e.target.dataset.note);if(l)l.note=e.target.value}});
document.addEventListener('change',e=>{if(e.target.name==='pm')pm=e.target.value});
sk.on('order:update',o=>{if(o.code===cur){if(o.payment_status==='lunas')qr=null;drawTrack(o)}});
sk.on('connect',()=>{if(cur){sk.emit('track',cur);load(cur)}});
try{data=await api('/api/menu')}catch(e){$('#menu').innerHTML=`<div class="err">${esc(e.message)}</div>`}
drawMenu();if(cur){sk.emit('track',cur);load(cur)}
})();
