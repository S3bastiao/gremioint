'use strict';
/* =====================================================================
   Grêmio · mulher.js — Diretoria da Mulher
   Relatos (validar, concluir, conversa anônima, acessos) e conteúdo do IF Delas.
   Tudo de relatos passa por funções do banco (05_mulher.sql), que checam o papel
   e gravam o acesso no servidor. Depende de core.js (db, $, esc, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'mulher');
  if (!mod) return;

  const CAT = { assedio: 'Assédio', preconceito: 'Preconceito', outro: 'Outro' };
  const VAL = { aguardando: ['Aguardando análise', ''], validado: ['Validado', 'ok'], invalidado: ['Invalidado', 'late'] };
  const STA = { pendente: ['Pendente', ''], concluido: ['Concluído', 'ok'] };
  const SEC = { apoio: 'Apoio no IF', direitos: 'Direitos e proteção', oportunidades: 'Oportunidades para elas', ajuda: 'Onde encontrar ajuda' };
  const dt = d => new Date(d).toLocaleDateString('pt-BR');
  const dth = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const pill = (map, k) => `<span class="pill ${map[k]?.[1] || ''}">${esc(map[k]?.[0] || k)}</span>`;
  const opts = (map, sel, todos) => `<option value="">${todos}</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${Array.isArray(v) ? v[0] : v}</option>`).join('');
  const urlOk = u => /^https?:\/\//i.test(u || '');
  const dlg = () => $('#dlg');

  let st = null;

  mod.render = el => {
    st = { aba: 'relatos', fs: '', fv: '' };
    el.innerHTML = `<h1>Diretoria da Mulher</h1>
      <p class="lead">Relatos de assédio e preconceito enviados pelos estudantes e o conteúdo do IF Delas. Cada abertura de relato fica registrada.</p>
      <div class="tabs" role="group" aria-label="Seções da Diretoria da Mulher">
        <button class="tab" data-aba="relatos" aria-pressed="true">Relatos</button>
        <button class="tab" data-aba="ifdelas" aria-pressed="false">IF Delas</button>
      </div><div id="mulBody"></div><dialog id="dlg" aria-label="Detalhes"></dialog>`;
    el.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      st.aba = b.dataset.aba;
      el.querySelectorAll('.tabs .tab').forEach(t => t.setAttribute('aria-pressed', String(t === b)));
      mostrar();
    });
    mostrar();
  };
  const mostrar = seguro(async () => { if (st.aba === 'relatos') await relatos(); else await ifdelas(); });

  function abrir(html, handler) {
    const d = dlg(); d.innerHTML = html;
    d.onclick = seguro(async e => {
      if (e.target === d || e.target.closest('[data-fechar]')) return d.close();
      if (handler) await handler(e);
    });
    d.onsubmit = null; d.onclose = () => { if (st.aba === 'relatos') mostrar(); };
    if (!d.open) d.showModal();
  }
  const cab = t => `<div class="item" style="border:0;padding-top:0"><h2>${esc(t)}</h2><button class="btn o sm" data-fechar>Fechar</button></div>`;

  /* ---------- relatos ---------- */
  async function relatos() {
    const c = $('#mulBody'); if (!c) return;
    const rows = ok(await db.rpc('listar_relatos', { p_status: st.fs || null, p_validacao: st.fv || null }));
    if (!$('#mulBody') || st.aba !== 'relatos') return;
    c.innerHTML = `<div class="filtros">
        <div><label class="sr" for="m-s">Status</label><select id="m-s">${opts(STA, st.fs, 'Todos os status')}</select></div>
        <div><label class="sr" for="m-v">Validação</label><select id="m-v">${opts(VAL, st.fv, 'Toda validação')}</select></div></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Protocolo</th><th>Categoria</th><th>Validação</th><th>Status</th><th>Enviado em</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr class="link" tabindex="0" data-id="${r.id}"><td>${esc(r.protocolo)}</td><td>${CAT[r.categoria] || esc(r.categoria)}</td><td>${pill(VAL, r.validacao)}</td><td>${pill(STA, r.status)}</td><td>${dt(r.criado_em)}</td></tr>`).join('')
        : `<tr><td colspan="5">${st.fs || st.fv ? 'Nenhum relato com esses filtros.' : 'Nenhum relato ainda. Os enviados pelo site dos estudantes aparecem aqui.'}</td></tr>`}</tbody></table></div>`;
    c.onchange = seguro(async e => { const k = { 'm-s': 'fs', 'm-v': 'fv' }[e.target.id]; if (k) { st[k] = e.target.value; await relatos(); } });
    c.onclick = seguro(async e => { const tr = e.target.closest('tr[data-id]'); if (tr) await relatoDlg(tr.dataset.id); });
    c.onkeydown = seguro(async e => { if (e.key === 'Enter' || e.key === ' ') { const tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); await relatoDlg(tr.dataset.id); } } });
  }

  async function relatoDlg(id) {
    const [r, msgs, acessos] = await Promise.all([db.rpc('abrir_relato', { p_id: id }), db.rpc('mensagens_relato', { p_id: id }), db.rpc('acessos_relato', { p_id: id })]).then(a => a.map(ok));
    const aberto = r.validacao === 'validado' && r.status === 'pendente';
    abrir(`<div class="dlg">${cab('Relato ' + r.protocolo)}
      <p class="lead" style="margin-top:0">${CAT[r.categoria] || esc(r.categoria)} · enviado em ${dt(r.criado_em)} · ${r.anonimo ? '<b>Anônimo</b>: nenhum dado de identificação foi guardado.' : `${esc(r.autor_nome || 'Sem nome')}${r.autor_turma ? ' · ' + esc(r.autor_turma) : ''}${r.autor_contato ? ' · ' + esc(r.autor_contato) : ''}`}</p>
      <p style="margin-top:14px;white-space:pre-wrap">${esc(r.texto)}</p>
      <div class="barra" style="margin-top:18px">${pill(VAL, r.validacao)}${pill(STA, r.status)}</div>
      <div class="barra" style="margin-top:12px">
        ${r.validacao !== 'validado' ? '<button class="btn sm" data-d="validado">Validar</button>' : ''}
        ${r.validacao !== 'invalidado' ? '<button class="btn o sm" data-d="invalidado">Invalidar</button>' : ''}
        ${r.status === 'pendente' ? '<button class="btn o sm" data-s="concluido">Marcar concluído</button>' : '<button class="btn o sm" data-s="pendente">Reabrir</button>'}</div>
      <div class="field" style="margin-top:18px"><label for="m-nota">Nota interna (só a diretoria vê)</label><textarea id="m-nota" rows="2" maxlength="1000">${esc(r.nota_interna || '')}</textarea></div>
      <button class="btn o sm" data-nota>Salvar nota</button>
      <h3 style="margin-top:26px">Conversa anônima</h3>
      ${r.validacao !== 'validado' ? '<p class="lead">A conversa abre quando o relato é validado. A pessoa acompanha só pelo protocolo e pela chave, sem identificação.</p>'
        : `<div style="margin-top:8px">${msgs.length ? msgs.map(m => `<div class="nota"><b>${m.remetente === 'diretoria' ? 'Diretoria' : 'Estudante'}</b> · ${dth(m.criado_em)}<br>${esc(m.texto)}</div>`).join('') : '<p class="lead">Nenhuma mensagem ainda.</p>'}</div>
        ${aberto ? `<div class="field" style="margin-top:12px"><label for="m-msg">Responder</label><textarea id="m-msg" rows="2" maxlength="2000"></textarea></div><button class="btn sm" data-enviar>Enviar mensagem</button>` : '<p class="lead">Conversa encerrada: o relato está concluído.</p>'}`}
      <h3 style="margin-top:26px">Quem acessou</h3>
      ${acessos.map(a => `<div class="nota">${esc(a.nome || 'Membro')} · ${esc(a.acao)}<small>${dth(a.quando)}</small></div>`).join('')}</div>`, async e => {
      const d = e.target.closest('[data-d]'), s = e.target.closest('[data-s]');
      if (d || s) {
        if (d?.dataset.d === 'invalidado' && !confirm('Invalidar este relato? A conversa não será aberta.')) return;
        ok(await db.rpc('decidir_relato', { p_id: id, p_validacao: d?.dataset.d || null, p_status: s?.dataset.s || null, p_nota: null }));
        toast('Relato atualizado.'); return relatoDlg(id);
      }
      if (e.target.closest('[data-nota]')) { ok(await db.rpc('decidir_relato', { p_id: id, p_validacao: null, p_status: null, p_nota: $('#m-nota').value })); return toast('Nota salva.'); }
      if (e.target.closest('[data-enviar]')) {
        const t = $('#m-msg').value.trim(); if (!t) return toast('Escreva a mensagem antes de enviar.');
        ok(await db.rpc('responder_relato', { p_id: id, p_texto: t })); toast('Mensagem enviada.'); return relatoDlg(id);
      }
    });
  }

  /* ---------- IF Delas (conteúdo público) ---------- */
  async function ifdelas() {
    const c = $('#mulBody'); if (!c) return;
    const rows = ok(await db.from('ifdelas_itens').select('*').order('ordem').order('criado_em'));
    if (!$('#mulBody') || st.aba !== 'ifdelas') return;
    c.innerHTML = `<div class="cal-head"><h2>Mapa de apoio</h2><button class="btn" data-novo>Novo item</button></div>
      <p class="lead" style="margin-top:0">O que estiver publicado aparece na aba IF Delas do site dos estudantes. Esta aba não guarda relatos.</p>
      ${Object.entries(SEC).map(([k, nome]) => { const l = rows.filter(r => r.secao === k); return `<h3 style="margin-top:26px">${nome}</h3>${l.length ? l.map(r => `<div class="item"><span><b>${esc(r.titulo)}</b>${r.texto ? '<br>' + esc(r.texto) : ''}${r.contato ? '<br>' + esc(r.contato) : ''}</span>
        <span class="barra" style="align-items:center">${r.publicado ? '<span class="pill ok">Publicado</span>' : '<span class="pill">Rascunho</span>'}<button class="btn o sm" data-ed="${r.id}">Editar</button><button class="btn o sm" data-rm="${r.id}" aria-label="Excluir ${esc(r.titulo)}">Excluir</button></span></div>`).join('') : '<p class="lead">Nada nesta área ainda.</p>'}`; }).join('')}`;
    c.onclick = seguro(async e => {
      if (e.target.closest('[data-novo]')) return editarItem({ secao: 'apoio', titulo: '', texto: '', contato: '', link: '', ordem: 0, publicado: true });
      const ed = e.target.closest('[data-ed]'); if (ed) return editarItem(rows.find(r => r.id === ed.dataset.ed));
      const rm = e.target.closest('[data-rm]');
      if (rm && confirm('Excluir este item do IF Delas?')) { ok(await db.from('ifdelas_itens').delete().eq('id', rm.dataset.rm)); await ifdelas(); }
    });
  }

  function editarItem(it) {
    if (!it) return;
    abrir(`<div class="dlg">${cab(it.id ? 'Editar item' : 'Novo item')}
      <form id="fit" novalidate>
        <div class="field"><label for="x-s">Área</label><select id="x-s">${Object.entries(SEC).map(([k, v]) => `<option value="${k}"${k === it.secao ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="x-t">Título</label><input id="x-t" maxlength="120" value="${esc(it.titulo)}" required></div>
        <div class="field"><label for="x-x">Descrição</label><textarea id="x-x" rows="3" maxlength="600">${esc(it.texto || '')}</textarea></div>
        <div class="row2"><div class="field"><label for="x-c">Contato, horário ou endereço</label><input id="x-c" maxlength="200" value="${esc(it.contato || '')}"></div>
        <div class="field"><label for="x-l">Link (https://…)</label><input id="x-l" type="url" maxlength="300" value="${esc(it.link || '')}"></div></div>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:16px"><input id="x-p" type="checkbox"${it.publicado ? ' checked' : ''}> Publicar no site dos estudantes</label>
        <button class="btn" type="submit">Salvar</button></form></div>`);
    dlg().onsubmit = seguro(async e => {
      e.preventDefault();
      const titulo = $('#x-t').value.trim(), link = $('#x-l').value.trim();
      if (!titulo) return toast('Dê um título ao item.');
      if (link && !urlOk(link)) return toast('O link precisa começar com http:// ou https://.');
      const v = { secao: $('#x-s').value, titulo, texto: $('#x-x').value.trim() || null, contato: $('#x-c').value.trim() || null, link: link || null, publicado: $('#x-p').checked };
      ok(it.id ? await db.from('ifdelas_itens').update(v).eq('id', it.id) : await db.from('ifdelas_itens').insert(v));
      dlg().close(); toast('Item salvo.'); await ifdelas();
    });
  }

  /* ---------- número no painel geral ---------- */
  mod.metrica = async () => {
    const r = ok(await db.rpc('listar_relatos', { p_status: 'pendente', p_validacao: null }));
    const n = r.filter(x => x.validacao === 'aguardando').length;
    return `${n} ${n === 1 ? 'relato aguardando análise' : 'relatos aguardando análise'}`;
  };
})();
