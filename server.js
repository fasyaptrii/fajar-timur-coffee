require('dotenv').config();
const express=require('express'),http=require('http'),path=require('path'),crypto=require('crypto');
const {Server}=require('socket.io'),bcrypt=require('bcryptjs'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),QRCode=require('qrcode');
const {pool,init}=require('./db');
const PROD=process.env.NODE_ENV==='production',HOURS=+process.env.SESSION_HOURS||8;
const TZ=/^[+-]\d\d:\d\d$/.test(process.env.TZ_OFFSET||'')?process.env.TZ_OFFSET:'+09:00';
const TZH=parseInt(TZ,10);
const MID_KEY=process.env.MIDTRANS_SERVER_KEY||'',MID_URL=process.env.MIDTRANS_BASE_URL||'https://api.sandbox.midtrans.com';
const SIM=!MID_KEY&&(!PROD||process.env.SIMULATE_PAYMENT==='true');
const app=express(),server=http.createServer(app),io=new Server(server);
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","https://cdnjs.cloudflare.com"],imgSrc:["'self'","data:"],connectSrc:["'self'","ws:","wss:"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:'50kb'}));
app.use(express.static(path.join(__dirname,'public')));

/* ---------- helper ---------- */
const wrap=f=>(q,s)=>f(q,s).catch(e=>{console.error(e);s.status(500).json({error:'Terjadi kesalahan pada server. Coba lagi.'})});
const bad=(s,m,c=400)=>s.status(c).json({error:m});
const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const int=(v,a,b)=>{v=Number(v);return Number.isInteger(v)&&v>=a&&v<=b?v:null};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const Q=(sql,p)=>pool.query(sql,p).then(r=>r[0]);
const dayStr=n=>new Date(Date.now()+TZH*36e5+n*864e5).toISOString().slice(0,10);
const LD=`DATE(CONVERT_TZ(o.created_at,'+00:00','${TZ}'))`;
const base=q=>(process.env.BASE_URL||`${q.protocol}://${q.get('host')}`).replace(/\/$/,'');
const cookie=(h,n)=>((h||'').split(/;\s*/).find(c=>c.startsWith(n+'='))||'').slice(n.length+1);
async function userFrom(h){const t=cookie(h,'ft_sid');if(!/^[a-f0-9]{64}$/.test(t))return null;return(await Q('SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.active=1',[sha(t)]))[0]||null}
const auth=(...roles)=>async(q,s,n)=>{try{const u=await userFrom(q.headers.cookie);if(!u)return bad(s,'Sesi berakhir. Silakan login kembali.',401);if(roles.length&&!roles.includes(u.role))return bad(s,'Anda tidak berhak mengakses fitur ini.',403);q.user=u;n()}catch(e){console.error(e);bad(s,'Kesalahan server',500)}};
const OWNER=auth('owner'),ADMIN=auth('admin'),KASIR=auth('kasir'),OA=auth('owner','admin');

/* ---------- login, sesi, halaman dashboard ---------- */
const loginLimit=rateLimit({windowMs:15*60e3,max:20,standardHeaders:true,legacyHeaders:false,message:{error:'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.'}});
app.post('/api/login',loginLimit,wrap(async(q,s)=>{
  const {username,password}=q.body||{};
  if(typeof username!=='string'||typeof password!=='string'||!username||!password)return bad(s,'Username dan password wajib diisi.');
  const u=(await Q('SELECT * FROM users WHERE username=? AND active=1',[username.trim().toLowerCase()]))[0];
  if(!u||!(await bcrypt.compare(password,u.password_hash)))return bad(s,'Username atau password salah.',401);
  const t=crypto.randomBytes(32).toString('hex');
  await Q('DELETE FROM sessions WHERE expires_at<NOW()');
  await Q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL ? HOUR))',[sha(t),u.id,HOURS]);
  s.setHeader('Set-Cookie',`ft_sid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${HOURS*3600}${PROD?'; Secure':''}`);
  s.json({role:u.role,redirect:'/'+u.role});
}));
app.post('/api/logout',wrap(async(q,s)=>{const t=cookie(q.headers.cookie,'ft_sid');if(t)await Q('DELETE FROM sessions WHERE token_hash=?',[sha(t)]);s.setHeader('Set-Cookie','ft_sid=; HttpOnly; Path=/; Max-Age=0');s.json({ok:1})}));
app.get('/api/me',auth(),(q,s)=>s.json(q.user));
['owner','admin','kasir'].forEach(r=>app.get('/'+r,async(q,s)=>{const u=await userFrom(q.headers.cookie).catch(()=>null);if(!u)return s.redirect('/login.html');if(u.role!==r)return s.redirect('/'+u.role);s.sendFile(path.join(__dirname,'views','dashboard.html'))}));

/* ---------- pelanggan (tanpa login) ---------- */
app.get('/api/menu',wrap(async(q,s)=>{
  const c=await Q('SELECT id,name FROM categories ORDER BY sort_order,id'),m=await Q('SELECT id,category_id,name,description,price FROM menu_items WHERE available=1 ORDER BY id');
  s.json({categories:c.map(x=>({...x,items:m.filter(i=>i.category_id===x.id)})).filter(x=>x.items.length)});
}));
app.get('/api/table',wrap(async(q,s)=>{
  const t=(await Q('SELECT id,number FROM dining_tables WHERE number=? AND code=? AND active=1',[int(q.query.meja,1,999)||0,str(q.query.k,12)]))[0];
  t?s.json({number:t.number}):bad(s,'Meja tidak ditemukan. Scan ulang QR di meja Anda.',404);
}));
app.post('/api/recommend',wrap(async(q,s)=>{
  const ids=(Array.isArray(q.body.ids)?q.body.ids:[]).map(Number).filter(Number.isInteger).slice(0,30);let rows=[];
  if(ids.length)rows=(await Q(`SELECT m.id,m.name,m.price,COUNT(*) score,'bersama' reason FROM order_items a JOIN order_items b ON a.order_id=b.order_id AND b.menu_item_id<>a.menu_item_id JOIN menu_items m ON m.id=b.menu_item_id WHERE a.menu_item_id IN (?) AND b.menu_item_id NOT IN (?) AND m.available=1 GROUP BY m.id,m.name,m.price ORDER BY score DESC LIMIT 4`,[ids,ids]));
  if(rows.length<4){const ex=[0,...ids,...rows.map(r=>r.id)];rows=rows.concat(await Q(`SELECT m.id,m.name,m.price,SUM(i.qty) score,'terlaris' reason FROM order_items i JOIN menu_items m ON m.id=i.menu_item_id WHERE m.available=1 AND m.id NOT IN (?) GROUP BY m.id,m.name,m.price ORDER BY score DESC LIMIT ?`,[ex,4-rows.length]))}
  s.json(rows);
}));
async function getOrder(col,val){const o=(await Q(`SELECT * FROM orders WHERE ${col}=?`,[val]))[0];if(!o)return null;o.items=await Q('SELECT menu_item_id,name,price,qty,note FROM order_items WHERE order_id=?',[o.id]);return o}
async function publish(code,isNew){const o=await getOrder('code',code);if(!o)return;io.to('staff').emit(isNew?'order:new':'order:update',o);io.to('o:'+code).emit('order:update',o)}
app.post('/api/orders',rateLimit({windowMs:60e3,max:30,standardHeaders:true,legacyHeaders:false,message:{error:'Terlalu banyak pesanan. Coba lagi sebentar.'}}),wrap(async(q,s)=>{
  const b=q.body||{},t=(await Q('SELECT id,number FROM dining_tables WHERE number=? AND code=? AND active=1',[int(b.meja,1,999)||0,str(b.k,12)]))[0];
  if(!t)return bad(s,'Meja tidak valid. Scan ulang QR di meja Anda.');
  const pm=b.payment_method;if(!['qris','tunai'].includes(pm))return bad(s,'Pilih metode pembayaran.');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>40)return bad(s,'Keranjang masih kosong.');
  const want=new Map();for(const i of b.items){const id=int(i.id,1,1e9),qty=int(i.qty,1,20);if(!id||!qty)return bad(s,'Data pesanan tidak valid.');want.set(id,{qty:(want.get(id)?.qty||0)+qty,note:str(i.note,120)})}
  const menu=await Q('SELECT id,name,price FROM menu_items WHERE available=1 AND id IN (?)',[[...want.keys()]]);
  if(menu.length!==want.size)return bad(s,'Ada menu yang tidak tersedia. Muat ulang halaman.');
  const lines=menu.map(m=>({...m,...want.get(m.id)})),total=lines.reduce((a,l)=>a+l.price*l.qty,0),code='FT'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const c=await pool.getConnection();
  try{await c.beginTransaction();const [r]=await c.query('INSERT INTO orders(code,table_id,table_number,customer_name,payment_method,total) VALUES(?,?,?,?,?,?)',[code,t.id,t.number,str(b.customer_name,40)||'Pelanggan',pm,total]);
    await c.query('INSERT INTO order_items(order_id,menu_item_id,name,price,qty,note) VALUES ?',[lines.map(l=>[r.insertId,l.id,l.name,l.price,l.qty,l.note])]);await c.commit()}
  catch(e){await c.rollback();throw e}finally{c.release()}
  publish(code,true);s.json({code});
}));
app.get('/api/orders/:code',wrap(async(q,s)=>{const o=await getOrder('code',str(q.params.code,12));o?s.json(o):bad(s,'Pesanan tidak ditemukan.',404)}));
app.get('/api/invoice/:code',wrap(async(q,s)=>{const o=await getOrder('code',str(q.params.code,12));if(!o)return bad(s,'Pesanan tidak ditemukan.',404);if(o.payment_status!=='lunas')return bad(s,'Invoice tersedia setelah pembayaran lunas.',403);s.json(o)}));
async function markPaid(code){const r=await pool.query("UPDATE orders SET payment_status='lunas',paid_at=NOW() WHERE code=? AND payment_status='belum' AND status<>'dibatalkan'",[code]);if(r[0].affectedRows)await publish(code);return r[0].affectedRows}
app.post('/api/orders/:code/qris',wrap(async(q,s)=>{
  const o=await getOrder('code',str(q.params.code,12));
  if(!o||o.payment_method!=='qris'||o.payment_status==='lunas'||o.status==='dibatalkan')return bad(s,'Pembayaran QRIS tidak tersedia untuk pesanan ini.');
  let qr='SIMULASI-QRIS|FAJARTIMUR|'+o.code+'|'+o.total;
  if(MID_KEY){
    const r=await fetch(MID_URL+'/v2/charge',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Basic '+Buffer.from(MID_KEY+':').toString('base64')},body:JSON.stringify({payment_type:'qris',transaction_details:{order_id:o.code,gross_amount:o.total},qris:{acquirer:'gopay'}})});
    const j=await r.json().catch(()=>({}));qr=j.qr_string;if(!qr)return bad(s,'QRIS belum dapat dibuat. Silakan bayar tunai di kasir atau coba lagi.',502);
  }else if(!SIM)return bad(s,'Pembayaran QRIS belum dikonfigurasi.',503);
  s.json({image:await QRCode.toDataURL(qr,{width:320,margin:1}),simulation:!MID_KEY,total:o.total});
}));
app.post('/api/orders/:code/simulate-pay',wrap(async(q,s)=>{if(!SIM)return bad(s,'Simulasi tidak aktif.',403);await markPaid(str(q.params.code,12));s.json({ok:1})}));
app.post('/api/payments/notification',wrap(async(q,s)=>{
  const b=q.body||{};if(!MID_KEY)return s.sendStatus(403);
  const sig=sha512(String(b.order_id)+b.status_code+b.gross_amount+MID_KEY);
  if(typeof b.signature_key!=='string'||b.signature_key.length!==sig.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(b.signature_key)))return s.sendStatus(403);
  if(['settlement','capture'].includes(b.transaction_status))await markPaid(String(b.order_id));
  s.sendStatus(200);
}));
const sha512=x=>crypto.createHash('sha512').update(x).digest('hex');

/* ---------- kasir ---------- */
app.get('/api/staff/orders',KASIR,wrap(async(q,s)=>{
  const ids=await Q(`SELECT o.id FROM orders o WHERE (o.status IN ('menunggu','diterima','diproses') OR ${LD}=?) AND o.status<>'dibatalkan' ORDER BY o.id DESC LIMIT 200`,[dayStr(0)]);
  const out=[];for(const r of ids.reverse()){const o=await getOrder('id',r.id);out.push(o)}s.json(out);
}));
const NEXT={menunggu:'diterima',diterima:'diproses',diproses:'selesai'};
app.patch('/api/staff/orders/:id/status',KASIR,wrap(async(q,s)=>{
  const o=await getOrder('id',int(q.params.id,1,1e9)||0);if(!o)return bad(s,'Pesanan tidak ditemukan.',404);
  const to=q.body.status;
  if(to==='dibatalkan'){if(o.status!=='menunggu'||o.payment_status==='lunas')return bad(s,'Hanya pesanan menunggu yang belum dibayar yang dapat dibatalkan.')}
  else if(NEXT[o.status]!==to)return bad(s,'Urutan status tidak valid.');
  else if(o.payment_method==='qris'&&o.payment_status!=='lunas')return bad(s,'Menunggu pembayaran QRIS pelanggan.');
  else if(to==='selesai'&&o.payment_status!=='lunas')return bad(s,'Konfirmasi pembayaran terlebih dahulu.');
  await Q('UPDATE orders SET status=? WHERE id=?',[to,o.id]);await publish(o.code);s.json({ok:1});
}));
app.post('/api/staff/orders/:id/pay-cash',KASIR,wrap(async(q,s)=>{
  const o=await getOrder('id',int(q.params.id,1,1e9)||0);if(!o||o.payment_method!=='tunai')return bad(s,'Pesanan tunai tidak ditemukan.',404);
  await markPaid(o.code);s.json({ok:1});
}));

/* ---------- admin: kategori, menu ---------- */
app.get('/api/admin/categories',ADMIN,wrap(async(q,s)=>s.json(await Q('SELECT c.*,(SELECT COUNT(*) FROM menu_items m WHERE m.category_id=c.id) n FROM categories c ORDER BY sort_order,id'))));
app.post('/api/admin/categories',ADMIN,wrap(async(q,s)=>{const n=str(q.body.name,40);if(!n)return bad(s,'Nama kategori wajib diisi.');
  try{await Q('INSERT INTO categories(name,sort_order) SELECT ?,COALESCE(MAX(sort_order),0)+1 FROM categories',[n])}catch(e){if(e.code==='ER_DUP_ENTRY')return bad(s,'Kategori sudah ada.');throw e}s.json({ok:1})}));
app.put('/api/admin/categories/:id',ADMIN,wrap(async(q,s)=>{const n=str(q.body.name,40);if(!n)return bad(s,'Nama kategori wajib diisi.');
  try{await Q('UPDATE categories SET name=? WHERE id=?',[n,int(q.params.id,1,1e9)||0])}catch(e){if(e.code==='ER_DUP_ENTRY')return bad(s,'Nama kategori sudah dipakai.');throw e}s.json({ok:1})}));
app.delete('/api/admin/categories/:id',ADMIN,wrap(async(q,s)=>{try{await Q('DELETE FROM categories WHERE id=?',[int(q.params.id,1,1e9)||0])}catch(e){if(/ROW_IS_REFERENCED/.test(e.code))return bad(s,'Kategori masih memiliki menu. Pindahkan atau hapus menunya dulu.');throw e}s.json({ok:1})}));
app.get('/api/admin/menu',ADMIN,wrap(async(q,s)=>s.json(await Q('SELECT m.*,c.name category FROM menu_items m JOIN categories c ON c.id=m.category_id ORDER BY c.sort_order,m.id'))));
const menuBody=b=>{const name=str(b.name,80),price=int(b.price,0,10000000),cat=int(b.category_id,1,1e9);return name&&price!==null&&cat?[cat,name,str(b.description,200),price,b.available===false||b.available===0?0:1]:null};
app.post('/api/admin/menu',ADMIN,wrap(async(q,s)=>{const v=menuBody(q.body);if(!v)return bad(s,'Nama, kategori, dan harga menu wajib diisi dengan benar.');
  try{await Q('INSERT INTO menu_items(category_id,name,description,price,available) VALUES(?,?,?,?,?)',v)}catch(e){if(/NO_REFERENCED/.test(e.code))return bad(s,'Kategori tidak valid.');throw e}s.json({ok:1})}));
app.put('/api/admin/menu/:id',ADMIN,wrap(async(q,s)=>{const v=menuBody(q.body);if(!v)return bad(s,'Nama, kategori, dan harga menu wajib diisi dengan benar.');
  await Q('UPDATE menu_items SET category_id=?,name=?,description=?,price=?,available=? WHERE id=?',[...v,int(q.params.id,1,1e9)||0]);s.json({ok:1})}));
app.delete('/api/admin/menu/:id',ADMIN,wrap(async(q,s)=>{await Q('DELETE FROM menu_items WHERE id=?',[int(q.params.id,1,1e9)||0]);s.json({ok:1})}));

/* ---------- admin: meja & QR ---------- */
const tUrl=(q,t)=>`${base(q)}/?meja=${t.number}&k=${t.code}`;
app.get('/api/admin/tables',ADMIN,wrap(async(q,s)=>s.json((await Q('SELECT * FROM dining_tables ORDER BY number')).map(t=>({...t,url:tUrl(q,t)})))));
app.post('/api/admin/tables',ADMIN,wrap(async(q,s)=>{const n=int(q.body.number,1,999);if(!n)return bad(s,'Nomor meja harus angka 1–999.');
  try{await Q('INSERT INTO dining_tables(number,code) VALUES(?,?)',[n,crypto.randomBytes(6).toString('hex')])}catch(e){if(e.code==='ER_DUP_ENTRY')return bad(s,'Nomor meja sudah ada.');throw e}s.json({ok:1})}));
app.put('/api/admin/tables/:id',ADMIN,wrap(async(q,s)=>{const n=int(q.body.number,1,999);if(!n)return bad(s,'Nomor meja harus angka 1–999.');
  try{await Q('UPDATE dining_tables SET number=?,active=? WHERE id=?',[n,q.body.active===false?0:1,int(q.params.id,1,1e9)||0])}catch(e){if(e.code==='ER_DUP_ENTRY')return bad(s,'Nomor meja sudah ada.');throw e}s.json({ok:1})}));
app.delete('/api/admin/tables/:id',ADMIN,wrap(async(q,s)=>{await Q('DELETE FROM dining_tables WHERE id=?',[int(q.params.id,1,1e9)||0]);s.json({ok:1})}));
app.get('/api/admin/tables/:id/qr.png',ADMIN,wrap(async(q,s)=>{
  const t=(await Q('SELECT * FROM dining_tables WHERE id=?',[int(q.params.id,1,1e9)||0]))[0];if(!t)return bad(s,'Meja tidak ditemukan.',404);
  const png=await QRCode.toBuffer(tUrl(q,t),{width:700,margin:2,color:{dark:'#14394F',light:'#FFFFFF'}});
  s.set({'Content-Type':'image/png','Cache-Control':'no-store'});if(q.query.dl)s.set('Content-Disposition',`attachment; filename="QR-Meja-${t.number}.png"`);s.send(png);
}));

/* ---------- admin: pengguna ---------- */
app.get('/api/admin/users',ADMIN,wrap(async(q,s)=>s.json(await Q('SELECT id,username,name,role,active,created_at FROM users ORDER BY FIELD(role,"owner","admin","kasir"),username'))));
app.post('/api/admin/users',ADMIN,wrap(async(q,s)=>{
  const u=str(q.body.username,30).toLowerCase(),n=str(q.body.name,60),p=q.body.password,r=q.body.role;
  if(!/^[a-z0-9_.]{3,30}$/.test(u))return bad(s,'Username 3–30 karakter: huruf kecil, angka, titik, atau garis bawah.');
  if(!n||typeof p!=='string'||p.length<8||p.length>72)return bad(s,'Nama wajib diisi dan password minimal 8 karakter.');
  if(!['admin','kasir'].includes(r))return bad(s,'Peran harus Admin atau Kasir.');
  try{await Q('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)',[u,n,await bcrypt.hash(p,10),r])}catch(e){if(e.code==='ER_DUP_ENTRY')return bad(s,'Username sudah dipakai.');throw e}s.json({ok:1});
}));
app.put('/api/admin/users/:id',ADMIN,wrap(async(q,s)=>{
  const id=int(q.params.id,1,1e9)||0,t=(await Q('SELECT * FROM users WHERE id=?',[id]))[0];if(!t)return bad(s,'Pengguna tidak ditemukan.',404);
  if(t.role==='owner')return bad(s,'Akun Owner tidak dapat diubah dari sini.',403);
  const n=str(q.body.name,60)||t.name,r=['admin','kasir'].includes(q.body.role)?q.body.role:t.role,a=q.body.active===false?0:1;
  if(id===q.user.id&&(!a||r!==t.role))return bad(s,'Anda tidak dapat menonaktifkan atau mengubah peran akun sendiri.');
  let h=t.password_hash;if(q.body.password){if(typeof q.body.password!=='string'||q.body.password.length<8||q.body.password.length>72)return bad(s,'Password minimal 8 karakter.');h=await bcrypt.hash(q.body.password,10)}
  await Q('UPDATE users SET name=?,role=?,active=?,password_hash=? WHERE id=?',[n,r,a,h,id]);
  if(!a||q.body.password)await Q('DELETE FROM sessions WHERE user_id=?',[id]);s.json({ok:1});
}));
app.delete('/api/admin/users/:id',ADMIN,wrap(async(q,s)=>{
  const id=int(q.params.id,1,1e9)||0,t=(await Q('SELECT role FROM users WHERE id=?',[id]))[0];
  if(!t)return bad(s,'Pengguna tidak ditemukan.',404);if(t.role==='owner'||id===q.user.id)return bad(s,'Akun ini tidak dapat dihapus.',403);
  await Q('DELETE FROM users WHERE id=?',[id]);s.json({ok:1});
}));

/* ---------- owner: laporan, riwayat, prediksi ---------- */
const range=q=>{const ok=v=>/^\d{4}-\d\d-\d\d$/.test(v||'');return[ok(q.from)?q.from:dayStr(-29),ok(q.to)?q.to:dayStr(0)]};
const PAID=`o.payment_status='lunas'`;
app.get('/api/owner/report',OWNER,wrap(async(q,s)=>{
  const R=range(q.query),W=`${PAID} AND ${LD} BETWEEN ? AND ?`;
  const [sum]=await Q(`SELECT COUNT(*) orders,COALESCE(SUM(total),0) revenue FROM orders o WHERE ${W}`,R);
  s.json({from:R[0],to:R[1],summary:sum,
    daily:await Q(`SELECT ${LD} d,SUM(total) revenue,COUNT(*) orders FROM orders o WHERE ${W} GROUP BY d ORDER BY d`,R),
    top:await Q(`SELECT i.name,SUM(i.qty) qty,SUM(i.qty*i.price) revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${W} GROUP BY i.name ORDER BY qty DESC LIMIT 10`,R),
    peak:await Q(`SELECT HOUR(CONVERT_TZ(o.created_at,'+00:00','${TZ}')) h,COUNT(*) orders FROM orders o WHERE ${W} GROUP BY h ORDER BY h`,R),
    method:await Q(`SELECT payment_method m,COUNT(*) orders,SUM(total) revenue FROM orders o WHERE ${W} GROUP BY payment_method`,R)});
}));
app.get('/api/owner/history',OWNER,wrap(async(q,s)=>{
  const R=range(q.query);
  s.json(await Q(`SELECT o.id,o.code,o.table_number,o.customer_name,o.total,o.payment_method,o.payment_status,o.status,o.created_at FROM orders o WHERE ${LD} BETWEEN ? AND ? ORDER BY o.id DESC LIMIT 300`,R));
}));
app.get('/api/owner/forecast',OWNER,wrap(async(q,s)=>{
  const rows=await Q(`SELECT ${LD} d,SUM(total) r FROM orders o WHERE ${PAID} AND ${LD}>=? GROUP BY d`,[dayStr(-56)]),m=Object.fromEntries(rows.map(r=>[r.d,+r.r]));
  const hist=[];for(let i=-55;i<=0;i++){const d=dayStr(i);hist.push({d,r:m[d]||0})}
  const wd=Array(7).fill(0),wc=Array(7).fill(0),dow=d=>new Date(d+'T00:00:00Z').getUTCDay();
  hist.forEach(h=>{wd[dow(h.d)]+=h.r;wc[dow(h.d)]++});
  const sum=a=>a.reduce((x,h)=>x+h.r,0),last=sum(hist.slice(-14)),prev=sum(hist.slice(-28,-14));
  const trend=prev>0?Math.max(-.3,Math.min(.3,last/prev-1)):0;
  const forecast=[];for(let i=1;i<=7;i++){const d=dayStr(i),k=dow(d);forecast.push({d,r:Math.round((wc[k]?wd[k]/wc[k]:0)*(1+trend)/1000)*1000})}
  const items=await Q(`SELECT i.name,SUM(i.qty) q FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${PAID} AND ${LD}>=? GROUP BY i.name ORDER BY q DESC`,[dayStr(-27)]);
  s.json({history:hist.slice(-14),forecast,trend:Math.round(trend*100),total:forecast.reduce((a,f)=>a+f.r,0),
    stock:items.map(x=>({name:x.name,daily:+(x.q/28).toFixed(1),need:Math.ceil(x.q/28*7*(1+trend)*1.1)}))});
}));

/* ---------- real-time ---------- */
io.on('connection',async sk=>{
  const u=await userFrom(sk.handshake.headers.cookie).catch(()=>null);
  if(u&&['kasir','owner'].includes(u.role))sk.join('staff');
  sk.on('track',c=>{if(typeof c==='string'&&/^[A-Z0-9]{6,12}$/.test(c))sk.join('o:'+c)});
});
init().then(()=>server.listen(process.env.PORT||3000,()=>console.log('Fajar Timur Coffee berjalan di port '+(process.env.PORT||3000)))).catch(e=>{console.error('Gagal inisialisasi database:',e.message);process.exit(1)});
