(async()=>{
  const m=$('#msg');if(location.search.includes('expired')){m.textContent='Sesi Anda berakhir. Silakan login kembali.';m.classList.remove('hidden')}
     else try{const r=await fetch('/api/me');if(r.ok){const u=await r.json();location.replace('/'+u.role)}}catch{}
  $('#f').addEventListener('submit',async e=>{e.preventDefault();m.classList.add('hidden');
    try{const r=await api('/api/login',{method:'POST',body:{username:$('#u').value,password:$('#p').value}});location.replace(r.redirect)}
    catch(x){m.textContent=x.message;m.classList.remove('hidden')}});
})();
