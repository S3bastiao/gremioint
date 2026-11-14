/* efeitos.js — só visual. Não lê nem altera dados, formulários ou chamadas ao Supabase. */
(()=>{
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const login=document.getElementById('login'), view=document.getElementById('view');
  const set=(el,k,v)=>el.style.setProperty(k,v);

  /* mouse: luz no login, parallax do retrato, brilho em cards/botões */
  let raf=0, ev=null;
  addEventListener('pointermove',e=>{ev=e;if(!raf)raf=requestAnimationFrame(()=>{raf=0;mover(ev)})},{passive:true});
  function mover(e){
    if(login&&login.classList.contains('show')){
      const r=login.getBoundingClientRect(), x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
      set(login,'--mx',(x*100).toFixed(1)+'%'); set(login,'--my',(y*100).toFixed(1)+'%');
      set(login,'--px',(x*2-1).toFixed(3));     set(login,'--py',(y*2-1).toFixed(3));
    }
    const t=e.target.closest&&e.target.closest('.card,.login-card,.btn,.day,.tab');
    if(!t) return;
    const r=t.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    set(t,'--gx',x+'px'); set(t,'--gy',y+'px');
    if(t.classList.contains('btn')&&!t.disabled){set(t,'--bx',((x-r.width/2)*.16).toFixed(1)+'px');set(t,'--by',((y-r.height/2)*.28).toFixed(1)+'px')}
  }
  document.addEventListener('pointerout',e=>{
    const b=e.target.closest&&e.target.closest('.btn');
    if(b&&!b.contains(e.relatedTarget)){b.style.removeProperty('--bx');b.style.removeProperty('--by')}
  },true);

  /* entrada escalonada: só quando o módulo muda (título diferente), para não piscar a cada re-render */
  if(!view) return;
  const SEL='h1,.lead,.stats,.tabs,.barra,.filtros,.cal-head,.cal,.chart,.chart .col,.tbl,.card,.item,.nota';
  let ultimo='', tm=0;
  new MutationObserver(()=>{
    const h=view.querySelector('h1'), t=h?h.textContent:'';
    if(!t||t===ultimo) return;
    ultimo=t;
    view.querySelectorAll(SEL).forEach((el,i)=>set(el,'--i',Math.min(i,18)));
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    clearTimeout(tm); tm=setTimeout(()=>view.classList.remove('enter'),1800);
  }).observe(view,{childList:true});
})();
