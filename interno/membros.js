'use strict';
/* =====================================================================
   Grêmio · membros.js — Membros e gestão (só a presidência)
   Libera acessos, dá e tira papéis, troca de gestão e mostra o histórico.
   As regras de verdade estão no banco (01_base.sql e 07_membros.sql).
   Depende de core.js (db, $, esc, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'membros');
  if (!mod) return;

  const PAP = { admin: 'Presidência', dir_social: 'Social', dir_mulher: 'Da Mulher', dir_infra: 'Infraestrutura', dir_tesouraria: 'Tesouraria', dir_esporte: 'Esporte', monitor: 'Monitor', professor: 'Professor' };
  const OP = { INSERT: 'Criou', UPDATE: 'Alterou', DELETE: 'Apagou' };
  const dia = d => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
  const dth = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const quem = p => p.nome || p.email || 'Sem nome';
  let st = null;

  mod.render = el => {
    st = { aba: 'membros' };
    el.innerHTML = `<h1>Membros e gestão</h1>
      <p class="lead">Quem acessa o painel, com qual papel, e a troca de gestão. Só a presidência vê esta área.</p>
      <div class="tabs" role="group" aria-label="Seções de Membros e gestão">
        <button class="tab" data-aba="membros" aria-pressed="true">Membros</button>
        <button class="tab" data-aba="gestoes" aria-pressed="false">Gestões</button>
        <button class="tab" data-aba="historico" aria-pressed="false">Histórico</button>
      </div><div id="memBody"></div>`;
    el.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      st.aba = b.dataset.aba;
      el.querySelectorAll('.tabs .tab').forEach(t => t.setAttribute('aria-pressed', String(t === b)));
      mostrar();
    });
    mostrar();
  };
  const mostrar = seguro(async () => { await ({ membros, gestoes, historico })[st.aba](); });

  /* ---------- membros ---------- */
  async function membros() {
    const c = $('#memBody'); if (!c) return;
    const [ps, rs] = await Promise.all([
      db.from('perfis').select('id,nome,email,ativo,criado_em').order('criado_em'),
      db.from('membros_papeis').select('id,user_id,papel').eq('ativo', true)
    ]).then(a => a.map(ok));
    if (!$('#memBody') || st.aba !== 'membros') return;
    ps.sort((a, b) => Number(a.ativo) - Number(b.ativo));
    const espera = ps.filter(p => !p.ativo).length;
    const linha = p => {
      const meus = rs.filter(r => r.user_id === p.id), n = esc(quem(p));
      return `<tr><td><b>${esc(p.nome || '(sem nome)')}</b><br><small>${esc(p.email || '')}</small></td>
        <td><span class="pill ${p.ativo ? 'ok' : ''}">${p.ativo ? 'Ativo' : 'Aguardando liberação'}</span></td>
        <td><span class="chips" style="margin:0">${meus.length ? meus.map(r => `<span class="chip">${PAP[r.papel] || esc(r.papel)}<button type="button" class="x" data-tirar="${r.id}" aria-label="Remover o papel ${PAP[r.papel] || ''} de ${n}">×</button></span>`).join('') : '<small>Sem papel</small>'}</span>
          <span class="barra" style="margin-top:8px"><select data-sel="${p.id}" aria-label="Papel para ${n}" style="width:auto">${Object.entries(PAP).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <button class="btn o sm" data-dar="${p.id}">Dar papel</button></span></td>
        <td><span class="barra"><button class="btn o sm" data-nome="${p.id}">Editar nome</button>
          <button class="btn ${p.ativo ? 'o ' : ''}sm" data-ativo="${p.id}" data-v="${p.ativo}">${p.ativo ? 'Desativar' : 'Liberar acesso'}</button></span></td></tr>`;
    };
    c.innerHTML = `<p class="lead" style="margin-top:22px">${espera ? `<b>${espera} ${espera === 1 ? 'pessoa aguarda' : 'pessoas aguardam'} liberação.</b> ` : ''}Para incluir alguém, crie o usuário em Authentication no Supabase; ele aparece aqui para você liberar e dar o papel.</p>
      <div style="overflow-x:auto;margin-top:14px"><table class="tbl"><thead><tr><th>Pessoa</th><th>Situação</th><th>Papéis na gestão atual</th><th></th></tr></thead><tbody>
      ${ps.length ? ps.map(linha).join('') : '<tr><td colspan="4">Nenhuma pessoa cadastrada ainda.</td></tr>'}</tbody></table></div>`;
    c.onclick = seguro(async e => {
      const t = e.target.closest('[data-tirar]');
      if (t) { ok(await db.from('membros_papeis').update({ ativo: false }).eq('id', t.dataset.tirar)); toast('Papel removido.'); return membros(); }
      const d = e.target.closest('[data-dar]');
      if (d) { ok(await db.rpc('dar_papel', { p_user: d.dataset.dar, p_papel: c.querySelector(`select[data-sel="${d.dataset.dar}"]`).value })); toast('Papel concedido.'); return membros(); }
      const a = e.target.closest('[data-ativo]');
      if (a) {
        const ativar = a.dataset.v !== 'true';
        if (!ativar && !confirm('Desativar este acesso? A pessoa não consegue mais entrar no painel.')) return;
        ok(await db.from('perfis').update({ ativo: ativar }).eq('id', a.dataset.ativo)); toast(ativar ? 'Acesso liberado.' : 'Acesso desativado.'); return membros();
      }
      const n = e.target.closest('[data-nome]');
      if (n) {
        const p = ps.find(x => x.id === n.dataset.nome), v = (prompt('Nome da pessoa:', p?.nome || '') || '').trim();
        if (!v) return; ok(await db.from('perfis').update({ nome: v }).eq('id', p.id)); return membros();
      }
    });
    c.onchange = null; c.onsubmit = null;
  }

  /* ---------- gestões (mandatos) ---------- */
  async function gestoes() {
    const c = $('#memBody'); if (!c) return;
    const ms = ok(await db.from('mandatos').select('*').order('inicio', { ascending: false }));
    if (!$('#memBody') || st.aba !== 'gestoes') return;
    const hoje = new Date(), h = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    c.innerHTML = `<form id="fm" class="barra" style="margin-top:22px" novalidate>
        <div class="field" style="flex:2;margin:0;min-width:200px"><label for="g-n">Nome da nova gestão</label><input id="g-n" maxlength="80" placeholder="Gestão 2027" required></div>
        <div class="field" style="width:170px;margin:0"><label for="g-i">Início</label><input id="g-i" type="date" value="${h}" required></div>
        <button class="btn" type="submit">Iniciar nova gestão</button></form>
      <p class="lead">Ao iniciar uma nova gestão, a atual é encerrada e todos os papéis, exceto o da presidência, são desativados. Você dá os papéis de novo na aba Membros. O histórico fica guardado.</p>
      <div style="margin-top:18px">${ms.length ? ms.map(m => `<div class="item"><span><b>${esc(m.nome)}</b><br><small>${dia(m.inicio)}${m.fim ? ' até ' + dia(m.fim) : ' até hoje'}</small></span>
        <span class="pill ${m.atual ? 'ok' : ''}">${m.atual ? 'Atual' : 'Encerrada'}</span></div>`).join('') : '<p class="lead">Nenhuma gestão cadastrada.</p>'}</div>`;
    c.onsubmit = seguro(async e => {
      e.preventDefault();
      const nome = $('#g-n').value.trim(); if (nome.length < 3) return toast('Dê um nome à nova gestão.');
      if (!confirm(`Iniciar "${nome}"? A gestão atual será encerrada e os papéis de todos, exceto a presidência, serão desativados.`)) return;
      ok(await db.rpc('virar_mandato', { p_nome: nome, p_inicio: $('#g-i').value || null }));
      toast('Nova gestão iniciada.'); await gestoes();
    });
    c.onclick = null; c.onchange = null;
  }

  /* ---------- histórico de alterações ---------- */
  async function historico() {
    const c = $('#memBody'); if (!c) return;
    const [au, ps] = await Promise.all([
      db.from('auditoria').select('id,quando,usuario,tabela,operacao').order('quando', { ascending: false }).limit(60),
      db.from('perfis').select('id,nome,email')
    ]).then(a => a.map(ok));
    if (!$('#memBody') || st.aba !== 'historico') return;
    const nome = Object.fromEntries(ps.map(p => [p.id, quem(p)]));
    c.innerHTML = `<p class="lead" style="margin-top:22px">As 60 alterações mais recentes. Relatos da Diretoria da Mulher ficam fora de propósito: o conteúdo deles não passa por aqui.</p>
      <div style="overflow-x:auto;margin-top:14px"><table class="tbl"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Onde</th></tr></thead><tbody>
      ${au.length ? au.map(a => `<tr><td>${dth(a.quando)}</td><td>${esc(nome[a.usuario] || 'Sistema')}</td><td>${OP[a.operacao] || esc(a.operacao)}</td><td>${esc(a.tabela)}</td></tr>`).join('')
        : '<tr><td colspan="4">Nenhuma alteração registrada ainda.</td></tr>'}</tbody></table></div>`;
    c.onclick = null; c.onchange = null; c.onsubmit = null;
  }

  /* ---------- número no painel geral ---------- */
  mod.metrica = async () => {
    const r = await db.from('perfis').select('id', { count: 'exact', head: true }).eq('ativo', false);
    if (r.error) throw new Error(r.error.message);
    const n = r.count ?? 0;
    return `${n} ${n === 1 ? 'pessoa aguardando liberação' : 'pessoas aguardando liberação'}`;
  };
})();
