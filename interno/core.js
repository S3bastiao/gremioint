'use strict';
/* =====================================================================
   Grêmio · core.js — login, papéis, menu por permissão e roteador.
   Cada módulo (Social, Esporte...) se registra com registrarModulo().
   IMPORTANTE: esconder um menu é só conforto. Quem barra o acesso de
   verdade são as regras (RLS) do banco, em sql/.
   ===================================================================== */

const db = supabase.createClient(GREMIO.url, GREMIO.anonKey);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const ctx = { user: null, nome: '', papeis: new Set(), ano: new Date().getFullYear() };
const MODULOS = [];
function registrarModulo(m) { MODULOS.push(m); }
const pode = m => ctx.papeis.has('admin') || m.papeis === '*' || m.papeis.some(p => ctx.papeis.has(p));

function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3200);
}

/* ---------- módulos (as telas reais entram nas próximas etapas) ---------- */
const emBreve = m => el => {
  el.innerHTML = `<h1>${esc(m.nome)}</h1><p class="lead">Este módulo entra nas próximas etapas do projeto.</p>`;
};
const painelGeral = el => {
  const lista = MODULOS.filter(m => m.id !== 'hub' && pode(m));
  el.innerHTML = `<h1>Painel geral</h1>
    <p class="lead">${lista.length ? 'Escolha uma diretoria para trabalhar.' : 'Seu perfil ainda não tem nenhuma diretoria. Peça à presidência para liberar.'}</p>
    <div class="grid">${lista.map(m => `<a class="card" href="#/${m.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${m.icone}"/></svg>
      <h3>${esc(m.nome)}</h3><p>${esc(m.desc)}</p><small class="metrica" data-m="${m.id}"></small></a>`).join('')}</div>`;
  lista.forEach(async m => {
    if (!m.metrica) return;
    try { const t = await m.metrica(); const s = el.querySelector(`[data-m="${m.id}"]`); if (s) s.textContent = t; } catch (_) {}
  });
};

[
  { id: 'hub',        nome: 'Painel geral',      papeis: '*', desc: '', icone: 'M4 11l8-7 8 7v9H4z', render: painelGeral },
  { id: 'social',     nome: 'Social',            papeis: ['dir_social'],     desc: 'Agenda de eventos, ingressos e sugestões.', icone: 'M3 6h18v14H3zM3 10h18M8 3v4M16 3v4' },
  { id: 'mulher',     nome: 'Da Mulher',         papeis: ['dir_mulher'],     desc: 'Relatos, acolhimento e IF Delas.',          icone: 'M12 21s-7-4.5-7-10V5l7-2 7 2v6c0 5.5-7 10-7 10z' },
  { id: 'infra',      nome: 'Infraestrutura',    papeis: ['dir_infra'],      desc: 'Estrutura escolar e achados e perdidos.',   icone: 'M14.7 6.3a4 4 0 1 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2z' },
  { id: 'tesouraria', nome: 'Tesouraria',        papeis: ['dir_tesouraria'], desc: 'Lançamentos, saldo e ideias de arrecadação.', icone: 'M5 6c0-2 14-2 14 0v12c0 2-14 2-14 0zM5 12c0 2 14 2 14 0' },
  { id: 'esporte',    nome: 'Esporte',           papeis: ['dir_esporte'],    desc: 'Torneios, chaveamento e credenciais de juízes.', icone: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M4 8h16M4 16h16' },
  { id: 'monitoria',  nome: 'Conecta Monitoria', papeis: ['monitor', 'professor'], desc: 'Monitorias, atendimentos e dúvidas.', icone: 'M4 5h16v11H8l-4 4z' },
  { id: 'membros',    nome: 'Membros e gestão',  papeis: [],                 desc: 'Acessos, papéis e troca de gestão.',          icone: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6' },
].forEach(m => registrarModulo({ render: emBreve(m), ...m }));

/* ---------- roteador por hash: #/social ---------- */
function rota() {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'hub';
  const m = MODULOS.find(x => x.id === id && pode(x)) || MODULOS[0];
  if (m.id !== id) { location.hash = '#/' + m.id; return; }
  document.querySelectorAll('#nav a').forEach(a => a.toggleAttribute('aria-current', a.dataset.id === m.id));
  document.querySelectorAll('#nav a[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
  document.title = `${m.nome} · Painel do Grêmio`;
  const v = $('#view'); v.innerHTML = ''; m.render(v, ctx); v.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => { if (ctx.user) rota(); });

/* ---------- login e sessão ---------- */
function mostrarLogin(msg) {
  $('#app').classList.remove('show'); $('#login').classList.add('show');
  const e = $('#loginErro'); e.textContent = msg || ''; e.classList.toggle('show', !!msg);
}

async function entrar(user) {
  const [perfil, papeis] = await Promise.all([
    db.from('perfis').select('nome,email,ativo').eq('id', user.id).maybeSingle(),
    db.from('membros_papeis').select('papel').eq('user_id', user.id).eq('ativo', true)
  ]);
  if (!perfil.data?.ativo || !papeis.data?.length) {
    await db.auth.signOut();
    return mostrarLogin('Sua conta ainda não foi liberada. Peça à presidência para ativar seu acesso.');
  }
  ctx.user = user; ctx.nome = perfil.data.nome || perfil.data.email;
  ctx.papeis = new Set(papeis.data.map(p => p.papel));

  $('#quem').textContent = ctx.nome;
  $('#nav').innerHTML = MODULOS.filter(pode).map(m => `<a href="#/${m.id}" data-id="${m.id}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${m.icone}"/></svg>${esc(m.nome)}</a>`).join('');
  $('#login').classList.remove('show'); $('#app').classList.add('show');
  rota();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn');
  if (GREMIO.url.includes('SEU-PROJETO')) return mostrarLogin('Falta configurar o Supabase em interno/config.js.');
  btn.disabled = true; btn.textContent = 'Entrando…';
  const { data, error } = await db.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#senha').value });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) return mostrarLogin('E-mail ou senha incorretos. Confira e tente de novo.');
  $('#senha').value = '';
  entrar(data.user);
});

$('#sairBtn').addEventListener('click', () => db.auth.signOut());
db.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') { ctx.user = null; ctx.papeis = new Set(); mostrarLogin(); } });

/* ---------- ano letivo e tema ---------- */
(() => {
  const sel = $('#ano'), atual = new Date().getFullYear();
  for (let y = atual - 2; y <= atual + 1; y++) sel.add(new Option(y + (y === atual ? ' (atual)' : ''), y, false, y === atual));
  sel.addEventListener('change', () => { ctx.ano = Number(sel.value); if (ctx.user) rota(); });
})();

(() => {
  const raiz = document.documentElement;
  try { const t = localStorage.getItem('tema'); if (t) raiz.dataset.theme = t; } catch (_) {}
  $('#temaBtn').addEventListener('click', () => {
    const claro = (raiz.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'light';
    raiz.dataset.theme = claro ? 'dark' : 'light';
    try { localStorage.setItem('tema', raiz.dataset.theme); } catch (_) {}
  });
})();

/* ---------- início ---------- */
(async () => {
  const { data: { session } } = await db.auth.getSession();
  session ? entrar(session.user) : mostrarLogin();
})();
