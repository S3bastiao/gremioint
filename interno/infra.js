'use strict';
/* =====================================================================
   Grêmio · infra.js — Diretoria de Infraestrutura
   Relatos (filtros, prioridade, status, foto, anotações) e achados e perdidos.
   Depende de core.js (db, $, esc, ctx, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'infra');
  if (!mod) return;

  const ST = { pendente: ['Pendente', ''], em_andamento: ['Em andamento', 'wip'], concluido: ['Concluído', 'ok'] };
  const PR = { baixa: ['Baixa', ''], media: ['Média', ''], alta: ['Alta', 'wip'], urgente: ['Urgente', 'late'] };
  const AC = { novo: ['Aguardando revisão', 'novo'], disponivel: ['Disponível', 'ok'], reivindicado: ['Reivindicado', 'wip'], devolvido: ['Devolvido', ''] };
  const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const dt = d => new Date(d).toLocaleDateString('pt-BR');
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const pill = (map, k) => `<span class="pill ${map[k]?.[1] || ''}">${esc(map[k]?.[0] || k)}</span>`;
  const opts = (map, sel, todos) => (todos ? `<option value="">${todos}</option>` : '') +
    Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v[0]}</option>`).join('');
  const foto = u => (/^https:\/\//.test(u || '') ? `<img class="foto" src="${esc(u)}" alt="Foto enviada com o registro" loading="lazy">` : '');
  const dlg = () => $('#dlg');

  let st = null;

  mod.render = el => {
    st = { aba: 'relatos', fs: '', fp: '', fl: '', ft: '', fa: '', sujo: false };
    el.innerHTML = `<h1>Infraestrutura</h1>
      <p class="lead">Relatos de estrutura da escola e achados e perdidos enviados pelos estudantes.</p>
      <div class="tabs" role="group" aria-label="Seções da Infraestrutura">
        <button class="tab" data-aba="relatos" aria-pressed="true">Relatos</button>
        <button class="tab" data-aba="achados" aria-pressed="false">Achados e perdidos</button>
      </div><div id="infraBody"></div><dialog id="dlg" aria-label="Detalhes"></dialog>`;
    el.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      st.aba = b.dataset.aba;
      el.querySelectorAll('.tabs .tab').forEach(t => t.setAttribute('aria-pressed', String(t === b)));
      mostrar();
    });
    dlg().addEventListener('close', () => { if (st.sujo) { st.sujo = false; mostrar(); } });
    mostrar();
  };
  const mostrar = seguro(async () => { if (st.aba === 'relatos') await relatos(); else await achados(); });

  function abrir(html, handler) {
    const d = dlg(); d.innerHTML = html;
    d.onclick = seguro(async e => {
      if (e.target === d || e.target.closest('[data-fechar]')) return d.close();
      if (handler) await handler(e);
    });
    if (!d.open) d.showModal();
  }
  const cab = t => `<div class="item" style="border:0;padding-top:0"><h2>${esc(t)}</h2><button class="btn o sm" data-fechar>Fechar</button></div>`;

  /* ---------- relatos ---------- */
  async function relatos() {
    const c = $('#infraBody'); if (!c) return;
    let q = db.from('infra_relatos').select('*').order('criado_em', { ascending: false }).limit(300);
    if (st.fs) q = q.eq('status', st.fs);
    if (st.fp) q = q.eq('prioridade', st.fp);
    if (st.fl) q = q.eq('local', st.fl);
    const rows = ok(await q);
    const locais = [...new Set(ok(await db.from('infra_relatos').select('local').limit(1000)).map(r => r.local))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!$('#infraBody') || st.aba !== 'relatos') return;
    c.innerHTML = `<div class="filtros">
        <div><label class="sr" for="f-s">Status</label><select id="f-s">${opts(ST, st.fs, 'Todos os status')}</select></div>
        <div><label class="sr" for="f-p">Prioridade</label><select id="f-p">${opts(PR, st.fp, 'Todas as prioridades')}</select></div>
        <div><label class="sr" for="f-l">Local</label><select id="f-l"><option value="">Todos os locais</option>${locais.map(l => `<option${l === st.fl ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Local</th><th>Prioridade</th><th>Status</th><th>Enviado em</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr class="link" tabindex="0" data-id="${r.id}"><td>${esc(r.local)}</td><td>${pill(PR, r.prioridade)}</td><td>${pill(ST, r.status)}</td><td>${dt(r.criado_em)}</td></tr>`).join('')
        : `<tr><td colspan="4">${st.fs || st.fp || st.fl ? 'Nenhum relato com esses filtros.' : 'Nenhum relato ainda. Quando os estudantes enviarem pelo site, eles aparecem aqui.'}</td></tr>`}</tbody></table></div>`;
    c.onchange = seguro(async e => {
      const m = { 'f-s': 'fs', 'f-p': 'fp', 'f-l': 'fl' }[e.target.id]; if (!m) return;
      st[m] = e.target.value; await relatos();
    });
    const abrirLinha = tr => tr && relatoDlg(tr.dataset.id);
    c.onclick = seguro(async e => abrirLinha(e.target.closest('tr[data-id]')));
    c.onkeydown = seguro(async e => { if (e.key === 'Enter' || e.key === ' ') { const tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); await abrirLinha(tr); } } });
  }

  async function relatoDlg(id) {
    const r = ok(await db.from('infra_relatos').select('*').eq('id', id).single());
    const notas = ok(await db.from('infra_notas').select('*').eq('relato_id', id).order('criado_em'));
    abrir(`<div class="dlg">${cab(r.local)}
      <p class="lead" style="margin-top:0">Enviado em ${dt(r.criado_em)}</p>${foto(r.foto_url)}
      <p>${esc(r.descricao || 'Sem descrição.')}</p>
      <div class="row2" style="margin-top:18px">
        <div class="field"><label for="r-st">Status</label><select id="r-st">${opts(ST, r.status)}</select></div>
        <div class="field"><label for="r-pr">Prioridade</label><select id="r-pr">${opts(PR, r.prioridade)}</select></div></div>
      <p><button class="btn" data-salvar>Salvar</button></p>
      <h3 style="margin-top:26px">Anotações</h3>
      ${notas.length ? notas.map(n => `<div class="nota">${esc(n.nota)}<small>${esc(n.autor_nome || 'Diretoria')} · ${dt(n.criado_em)}</small></div>`).join('') : '<p class="lead">Nenhuma anotação ainda.</p>'}
      <div class="field" style="margin-top:14px"><label for="r-nota">Nova anotação</label><textarea id="r-nota" rows="2" maxlength="500"></textarea></div>
      <button class="btn o" data-nota>Adicionar anotação</button></div>`, async e => {
      if (e.target.closest('[data-salvar]')) {
        ok(await db.from('infra_relatos').update({ status: $('#r-st').value, prioridade: $('#r-pr').value }).eq('id', id));
        st.sujo = true; toast('Relato atualizado.'); return;
      }
      if (e.target.closest('[data-nota]')) {
        const nota = $('#r-nota').value.trim(); if (!nota) return toast('Escreva a anotação antes de adicionar.');
        ok(await db.from('infra_notas').insert({ relato_id: id, nota, autor_nome: ctx.nome }));
        toast('Anotação adicionada.'); return relatoDlg(id);
      }
    });
  }

  /* ---------- achados e perdidos ---------- */
  async function achados() {
    const c = $('#infraBody'); if (!c) return;
    let q = db.from('achados_perdidos').select('*').order('criado_em', { ascending: false }).limit(300);
    if (st.fa) q = q.eq('status_admin', st.fa);
    if (st.ft) q = q.eq('tipo', st.ft);
    const rows = ok(await q);
    if (!$('#infraBody') || st.aba !== 'achados') return;
    c.innerHTML = `<div class="filtros">
        <div><label class="sr" for="a-s">Status</label><select id="a-s">${opts(AC, st.fa, 'Todos os status')}</select></div>
        <div><label class="sr" for="a-t">Tipo</label><select id="a-t"><option value="">Achados e perdidos</option><option value="achado"${st.ft === 'achado' ? ' selected' : ''}>Só achados</option><option value="perdido"${st.ft === 'perdido' ? ' selected' : ''}>Só perdidos</option></select></div></div>
      ${rows.length ? rows.map(a => `<article class="card" style="margin-top:12px">${foto(a.foto_url)}
        <div class="item" style="border:0;padding:0"><b>${esc(a.item_nome)}</b>${pill(AC, a.status_admin)}</div>
        <p class="lead" style="margin-top:4px;font-size:.85rem">${a.tipo === 'perdido' ? 'Perdido' : 'Achado'}${a.local ? ' em ' + esc(a.local) : ''} · ${dt(a.criado_em)}${a.reivindicado_por ? ' · Reivindicado por ' + esc(a.reivindicado_por) : ''}</p>
        ${a.descricao ? `<p style="margin-top:8px">${esc(a.descricao)}</p>` : ''}
        <div class="barra" style="margin-top:12px">${acoesAchado(a)}</div></article>`).join('')
        : `<p class="lead" style="margin-top:18px">${st.fa || st.ft ? 'Nada com esses filtros.' : 'Nenhum item registrado. Os itens enviados pelos estudantes aparecem aqui para você revisar.'}</p>`}`;
    c.onchange = seguro(async e => {
      if (e.target.id === 'a-s') { st.fa = e.target.value; await achados(); }
      if (e.target.id === 'a-t') { st.ft = e.target.value; await achados(); }
    });
    c.onclick = seguro(async e => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      const rem = b.dataset.rm;
      if (rem) { if (!confirm('Remover este item e a foto dele?')) return; await apagarFoto(rows.find(x => x.id === rem)?.foto_url); ok(await db.from('achados_perdidos').delete().eq('id', rem)); return achados(); }
      const patch = { status_admin: b.dataset.st };
      if (b.dataset.st === 'reivindicado') {
        const quem = (prompt('Quem está reivindicando o item? (nome e turma)') || '').trim();
        if (!quem) return toast('Informe quem está reivindicando.');
        patch.reivindicado_por = quem;
      }
      if (b.dataset.st === 'disponivel') patch.reivindicado_por = null;
      ok(await db.from('achados_perdidos').update(patch).eq('id', b.dataset.id)); return achados();
    });
  }
  const acoesAchado = a => {
    const bt = (st2, t, cls = 'o') => `<button class="btn ${cls} sm" data-st="${st2}" data-id="${a.id}">${t}</button>`;
    const rm = `<button class="btn o sm" data-st="x" data-rm="${a.id}" aria-label="Remover ${esc(a.item_nome)}">Remover</button>`;
    if (a.status_admin === 'novo') return bt('disponivel', 'Publicar', '') + rm;
    if (a.status_admin === 'disponivel') return bt('reivindicado', 'Marcar reivindicado') + bt('devolvido', 'Marcar devolvido') + rm;
    if (a.status_admin === 'reivindicado') return bt('devolvido', 'Marcar devolvido', '') + bt('disponivel', 'Reabrir') + rm;
    return bt('disponivel', 'Reabrir') + rm;
  };
  async function apagarFoto(url) {
    const m = (url || '').match(/\/fotos\/((?:infra|achados)\/[^?]+)/);
    if (m) await db.storage.from('fotos').remove([decodeURIComponent(m[1])]);
  }

  /* ---------- números no painel geral ---------- */
  mod.metrica = async () => {
    const [a, b] = await Promise.all([
      db.from('infra_relatos').select('id', { count: 'exact', head: true }).neq('status', 'concluido'),
      db.from('achados_perdidos').select('id', { count: 'exact', head: true }).eq('status_admin', 'novo')
    ]);
    if (a.error) throw new Error(a.error.message);
    return `${pl(a.count ?? 0, 'relato aberto', 'relatos abertos')} · ${pl(b.count ?? 0, 'item para revisar', 'itens para revisar')}`;
  };
})();
