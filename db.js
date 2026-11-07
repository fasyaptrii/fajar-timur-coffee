const mysql=require('mysql2/promise'),fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs');
const url=process.env.MYSQL_URL||process.env.DATABASE_URL;
const pool=mysql.createPool(url?{uri:url,waitForConnections:true,connectionLimit:15,dateStrings:true,timezone:'Z'}:{host:process.env.MYSQLHOST||'localhost',port:+process.env.MYSQLPORT||3306,user:process.env.MYSQLUSER||'root',password:process.env.MYSQLPASSWORD||'',database:process.env.MYSQLDATABASE||'fajar_timur',waitForConnections:true,connectionLimit:15,dateStrings:true,timezone:'Z'});
pool.on('connection',c=>c.query("SET time_zone='+00:00'"));
const MENU={Kopi:[['Espresso',25000],['Americano',30000],['Cafe Latte',35000],['Cappuccino',35000],['Kopi Susu Gula Aren',35000],['Caramel Macchiato',38000],['Mocha',38000]],'Non-Kopi':[['Chocolate',34000],['Matcha Latte',40000],['Red Velvet Latte',40000],['Thai Tea',30000]],'Makanan Berat':[['Nasi Goreng Spesial',40000],['Nasi Ayam Teriyaki',35000],['Mie Goreng Seafood',40000],['Chicken Katsu Rice',45000]],Camilan:[['Kentang Goreng',25000],['Pisang Goreng Keju',30000],['Chicken Wings (5 pcs)',35000],['Dimsum Ayam (4 pcs)',30000],['Roti Bakar Coklat Keju',27000]]};
const PAIR={'Espresso':'Roti Bakar Coklat Keju','Cafe Latte':'Kentang Goreng','Cappuccino':'Pisang Goreng Keju','Americano':'Kentang Goreng','Kopi Susu Gula Aren':'Pisang Goreng Keju','Nasi Goreng Spesial':'Thai Tea','Chicken Katsu Rice':'Thai Tea','Mie Goreng Seafood':'Thai Tea','Matcha Latte':'Dimsum Ayam (4 pcs)'};
const q=(sql,p)=>pool.query(sql,p);
async function init(){
  for(const s of fs.readFileSync(path.join(__dirname,'database/schema.sql'),'utf8').split(';').map(x=>x.trim()).filter(Boolean))await q(s);
  if(!(await q('SELECT 1 FROM users LIMIT 1'))[0].length){
    for(const [u,n,r,p] of [['owner','Pemilik Fajar Timur','owner',process.env.OWNER_PASSWORD||'Owner#2026'],['admin','Administrator','admin',process.env.ADMIN_PASSWORD||'Admin#2026'],['kasir','Kasir Utama','kasir',process.env.KASIR_PASSWORD||'Kasir#2026']])
      await q('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)',[u,n,await bcrypt.hash(p,10),r]);
  }
  if(!(await q('SELECT 1 FROM categories LIMIT 1'))[0].length){
    let i=0;for(const [c,items] of Object.entries(MENU)){const [r]=await q('INSERT INTO categories(name,sort_order) VALUES(?,?)',[c,++i]);await q('INSERT INTO menu_items(category_id,name,price) VALUES ?',[items.map(x=>[r.insertId,x[0],x[1]])]);}
  }
  if(!(await q('SELECT 1 FROM dining_tables LIMIT 1'))[0].length)
    await q('INSERT INTO dining_tables(number,code) VALUES ?',[Array.from({length:12},(_,i)=>[i+1,crypto.randomBytes(6).toString('hex')])]);
  if(process.env.SEED_DEMO!=='false'&&!(await q('SELECT 1 FROM orders LIMIT 1'))[0].length)await seedDemo();
}
async function seedDemo(){
  const [items]=await q('SELECT id,name,price FROM menu_items'),by=Object.fromEntries(items.map(i=>[i.name,i]));
  const hours=[8,9,9,9,10,10,11,12,12,12,13,13,14,15,16,17,18,19,19,19,20,20,21];
  const ts=d=>d.toISOString().slice(0,19).replace('T',' ');
  const O=[],I=[];let id=0;
  for(let d=60;d>=1;d--){
    const day=new Date(Date.now()-d*864e5),wd=new Date(day.getTime()+9*36e5).getUTCDay();
    const n=Math.round((14+(wd===0||wd===6?9:wd===5?4:0)+(60-d)/5)*(.8+Math.random()*.4));
    for(let k=0;k<n;k++){
      const t=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hours[Math.floor(Math.random()*hours.length)]-9,Math.floor(Math.random()*60)));
      const first=items[Math.floor(Math.random()*items.length)],pick=[[first,1]];
      if(PAIR[first.name]&&Math.random()<.6)pick.push([by[PAIR[first.name]],1]);
      else if(Math.random()<.3)pick.push([items[Math.floor(Math.random()*items.length)],1]);
      const total=pick.reduce((a,[i,c])=>a+i.price*c,0),m=Math.random()<.6?'qris':'tunai';id++;
      O.push([id,'DM'+crypto.randomBytes(5).toString('hex').toUpperCase().slice(0,8),1+Math.floor(Math.random()*12),'Pelanggan','selesai',m,'lunas',total,ts(t),ts(t)]);
      pick.forEach(([i,c])=>I.push([id,i.id,i.name,i.price,c]));
    }
  }
  for(let a=0;a<O.length;a+=500)await q('INSERT INTO orders(id,code,table_number,customer_name,status,payment_method,payment_status,total,created_at,paid_at) VALUES ?',[O.slice(a,a+500)]);
  for(let a=0;a<I.length;a+=1000)await q('INSERT INTO order_items(order_id,menu_item_id,name,price,qty) VALUES ?',[I.slice(a,a+1000)]);
  console.log(`Data contoh: ${O.length} transaksi dibuat.`);
}
module.exports={pool,init};
