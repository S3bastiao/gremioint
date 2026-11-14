'use strict';
/* =====================================================================
   Grêmio · tesouraria.js — Diretoria de Tesouraria
   Resumo do ano, gráfico mensal, lançamentos (criar, editar, excluir) e ideias.
   Depende de core.js (db, $, esc, ctx, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'tesouraria');
  if (!mod) return;

  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const IDEIA = { proposta: ['Proposta', ''], em_andamento: ['Em andamento', 'wip'], concluida: ['Concluída', 'ok'], descartada: ['Descartada', 'late'] };
  const POR_PAGINA = 20;
  const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const br = d => d.split('-').reverse().join('/');
  const hoje = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`; };
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const cor = v => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
  const dlg = () => $('#dlg');

  let st = null;

  mod.render = el => {
    st = { aba: 'lanc', ano: ctx.ano, tipo: '', pg: 0, sujo: false };
    el.innerHTML = `<h1>Tesouraria</h1>
      <p class="lead">Contas do grêmio em ${st.ano}: saldo, lançamentos e ideias de arrecadação.</p>
      <div class="tabs" role="group" aria-label="Seções da Tesouraria">
        <button class="tab" data-aba="lanc" aria-pressed="true">Lançamentos</button>
        <button class="tab" data-aba="ideias" aria-pressed="false">Ideias de arrecadação</button>
      </div><div id="tesBody"></div><dialog id="dlg" aria-label="Editar lançamento"></dialog>`;
    el.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      st.aba = b.dataset.aba;
      el.querySelectorAll('.tabs .tab').forEach(t => t.setAttribute('aria-pressed', String(t === b)));
      mostrar();
    });
    mostrar();
  };
  const mostrar = seguro(async () => { if (st.aba === 'lanc') await lancamentos(); else await ideias(); });

  /* ---------- lançamentos ---------- */
  async function lancamentos() {
    const c = $('#tesBody'); if (!c) return;
    const { ano } = st;
    const ini = `${ano}-01-01`, fim = `${ano}-12-31`;
    let q = db.from('financeiro_registros').select('*', { count: 'exact' }).gte('data', ini).lte('data', fim)
      .order('data', { ascending: false }).order('criado_em', { ascending: false }).range(st.pg * POR_PAGINA, st.pg * POR_PAGINA + POR_PAGINA - 1);
    if (st.tipo) q = q.eq('tipo', st.tipo);
    const [resumo, lista] = await Promise.all([db.rpc('resumo_tesouraria', { p_ano: ano }), q]);
    const r = ok(resumo), rows = ok(lista), total = lista.count ?? rows.length;
    if (!$('#tesBody') || st.aba !== 'lanc' || st.ano !== ano) return;
    const max = Math.max(1, ...r.meses.map(Math.abs)), res = r.ganhos - r.gastos, pgs = Math.max(1, Math.ceil(total / POR_PAGINA));
    c.innerHTML = `<div class="stats" style="margin-top:22px">
        <div><b class="${cor(r.saldo)}">${brl(r.saldo)}</b>saldo geral (todos os anos)</div>
        <div><b>${brl(r.ganhos)}</b>ganhos em ${ano}</div><div><b>${brl(r.gastos)}</b>gastos em ${ano}</div>
        <div><b class="${cor(res)}">${brl(res)}</b>resultado de ${ano}</div></div>
      <div class="chart" role="img" aria-label="Resultado por mês em ${ano}: ${r.meses.map((v, i) => `${MES[i]} ${brl(v)}`).join(', ')}">
        ${r.meses.map((v, i) => `<div class="col"><div class="up">${v > 0 ? `<i style="height:${v / max * 100}%"></i>` : ''}</div><div class="dn">${v < 0 ? `<i style="height:${-v / max * 100}%"></i>` : ''}</div><span>${MES[i]}</span></div>`).join('')}</div>
      <form id="flanc" class="barra" novalidate>
        <div class="field" style="width:130px;margin:0"><label for="l-t">Tipo</label><select id="l-t"><option value="ganho">Ganho</option><option value="gasto">Gasto</option></select></div>
        <div class="field" style="width:160px;margin:0"><label for="l-d">Data</label><input id="l-d" type="date" value="${st.ano === new Date().getFullYear() ? hoje() : ano + '-01-01'}" required></div>
        <div class="field" style="flex:2;margin:0;min-width:160px"><label for="l-o">Descrição</label><input id="l-o" maxlength="120" required></div>
        <div class="field" style="width:130px;margin:0"><label for="l-v">Valor (R$)</label><input id="l-v" type="number" min="0.01" step="0.01" required></div>
        <button class="btn" type="submit">Lançar</button></form>
      <div class="filtros"><div><label class="sr" for="l-f">Filtrar</label><select id="l-f"><option value="">Ganhos e gastos</option><option value="ganho"${st.tipo === 'ganho' ? ' selected' : ''}>Só ganhos</option><option value="gasto"${st.tipo === 'gasto' ? ' selected' : ''}>Só gastos</option></select></div></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map(x => `<tr><td>${br(x.data)}</td><td><span class="pill ${x.tipo === 'ganho' ? 'ok' : 'late'}">${x.tipo === 'ganho' ? 'Ganho' : 'Gasto'}</span></td><td>${esc(x.oque)}</td>
        <td class="${x.tipo === 'ganho' ? 'pos' : 'neg'}">${x.tipo === 'gasto' ? '−' : ''}${brl(x.valor)}</td>
        <td><span class="barra"><button class="btn o sm" data-ed="${x.id}" aria-label="Editar ${esc(x.oque)}">Editar</button><button class="btn o sm" data-rm="${x.id}" aria-label="Excluir ${esc(x.oque)}">Excluir</button></span></td></tr>`).join('')
        : `<tr><td colspan="5">Nenhum lançamento em ${ano}${st.tipo ? ' com esse filtro' : ''}. Use o formulário acima.</td></tr>`}</tbody></table></div>
      <div class="pager"><button class="btn o sm" data-pg="-1"${st.pg === 0 ? ' disabled' : ''}>Anterior</button><span>Página ${st.pg + 1} de ${pgs}</span><button class="btn o sm" data-pg="1"${st.pg + 1 >= pgs ? ' disabled' : ''}>Próxima</button></div>`;
    c.onsubmit = seguro(async e => {
      e.preventDefault();
      const o = $('#l-o').value.trim(), v = Math.round(Number($('#l-v').value) * 100) / 100, d = $('#l-d').value;
      if (!o) return toast('Descreva o lançamento.');
      if (!(v > 0)) return toast('Informe um valor maior que zero.');
      if (!d) return toast('Escolha a data.');
      ok(await db.from('financeiro_registros').insert({ tipo: $('#l-t').value, data: d, oque: o, valor: v }));
      toast('Lançamento registrado.'); st.pg = 0; await lancamentos();
    });
    c.onchange = seguro(async e => { if (e.target.id === 'l-f') { st.tipo = e.target.value; st.pg = 0; await lancamentos(); } });
    c.onclick = seguro(async e => {
      const p = e.target.closest('[data-pg]'); if (p) { st.pg += Number(p.dataset.pg); return lancamentos(); }
      const ed = e.target.closest('[data-ed]'); if (ed) return editar(rows.find(x => x.id === ed.dataset.ed));
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        if (!confirm('Excluir este lançamento? A exclusão fica registrada na auditoria.')) return;
        ok(await db.from('financeiro_registros').delete().eq('id', rm.dataset.rm));
        toast('Lançamento excluído.'); if (rows.length === 1 && st.pg > 0) st.pg--; await lancamentos();
      }
    });
  }

  function editar(x) {
    if (!x) return;
    const d = dlg();
    d.innerHTML = `<div class="dlg"><div class="item" style="border:0;padding-top:0"><h2>Editar lançamento</h2><button class="btn o sm" data-fechar>Fechar</button></div>
      <form id="fed" novalidate><div class="row2">
        <div class="field"><label for="e-t">Tipo</label><select id="e-t"><option value="ganho"${x.tipo === 'ganho' ? ' selected' : ''}>Ganho</option><option value="gasto"${x.tipo === 'gasto' ? ' selected' : ''}>Gasto</option></select></div>
        <div class="field"><label for="e-d">Data</label><input id="e-d" type="date" value="${x.data}" required></div></div>
      <div class="field"><label for="e-o">Descrição</label><input id="e-o" maxlength="120" value="${esc(x.oque)}" required></div>
      <div class="field"><label for="e-v">Valor (R$)</label><input id="e-v" type="number" min="0.01" step="0.01" value="${x.valor}" required></div>
      <button class="btn" type="submit">Salvar alterações</button></form></div>`;
    d.onclick = e => { if (e.target === d || e.target.closest('[data-fechar]')) d.close(); };
    d.onsubmit = seguro(async e => {
      e.preventDefault();
      const o = $('#e-o').value.trim(), v = Math.round(Number($('#e-v').value) * 100) / 100, dt = $('#e-d').value;
      if (!o || !dt) return toast('Preencha a descrição e a data.');
      if (!(v > 0)) return toast('Informe um valor maior que zero.');
      ok(await db.from('financeiro_registros').update({ tipo: $('#e-t').value, data: dt, oque: o, valor: v }).eq('id', x.id));
      d.close(); toast('Lançamento atualizado.'); await lancamentos();
    });
    d.showModal();
  }

  /* ---------- ideias de arrecadação ---------- */
  async function ideias() {
    const c = $('#tesBody'); if (!c) return;
    const rows = ok(await db.from('ideias_arrecadacao').select('*').order('criado_em', { ascending: false }).limit(200));
    if (!$('#tesBody') || st.aba !== 'ideias') return;
    c.innerHTML = `<form id="fide" class="barra" style="margin-top:22px" novalidate>
        <div class="field" style="flex:1;margin:0;min-width:220px"><label for="i-t">Nova ideia</label><input id="i-t" maxlength="200" required></div>
        <button class="btn" type="submit">Adicionar</button></form>
      <div style="margin-top:18px">${rows.length ? rows.map(i => `<div class="item"><span>${esc(i.texto)}</span>
        <span class="barra" style="align-items:center"><span class="pill ${IDEIA[i.status]?.[1] || ''}">${IDEIA[i.status]?.[0] || esc(i.status)}</span>
          <select data-id="${i.id}" aria-label="Status de: ${esc(i.texto)}" style="width:auto">${Object.entries(IDEIA).map(([k, v]) => `<option value="${k}"${k === i.status ? ' selected' : ''}>${v[0]}</option>`).join('')}</select>
          <button class="btn o sm" data-rm="${i.id}" aria-label="Remover ${esc(i.texto)}">Remover</button></span></div>`).join('')
        : '<p class="lead">Nenhuma ideia ainda. Registre rifas, vendas e eventos para arrecadar.</p>'}</div>`;
    c.onsubmit = seguro(async e => {
      e.preventDefault(); const t = $('#i-t').value.trim(); if (!t) return toast('Escreva a ideia antes de adicionar.');
      ok(await db.from('ideias_arrecadacao').insert({ texto: t })); await ideias();
    });
    c.onchange = seguro(async e => {
      const s = e.target.closest('select[data-id]'); if (!s) return;
      ok(await db.from('ideias_arrecadacao').update({ status: s.value }).eq('id', s.dataset.id)); await ideias();
    });
    c.onclick = seguro(async e => {
      const r = e.target.closest('[data-rm]'); if (!r || !confirm('Remover esta ideia?')) return;
      ok(await db.from('ideias_arrecadacao').delete().eq('id', r.dataset.rm)); await ideias();
    });
  }

  /* ---------- número no painel geral ---------- */
  mod.metrica = async () => {
    const r = ok(await db.rpc('resumo_tesouraria', { p_ano: new Date().getFullYear() }));
    return `Saldo ${brl(r.saldo)}`;
  };
})();
