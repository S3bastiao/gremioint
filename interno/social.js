'use strict';
/* =====================================================================
   Grêmio · social.js — Diretoria Social
   Agenda mensal, evento em vários dias, recursos, ingressos e sugestões.
   Depende de core.js (db, $, esc, ctx, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'social');
  if (!mod) return;

  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const CATS = ['Cultural', 'Tecnologia', 'Conscientização', 'Esportivo', 'Outro'];
  const p2 = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
  const br = d => d.split('-').reverse().join('/');
  const hhmm = t => (t ? t.slice(0, 5) : '');
  const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const opts = (lista, sel) => lista.map(x => `<option${x === sel ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const dlg = () => $('#dlg');

  let st = null;

  /* ---------- tela principal ---------- */
  mod.render = el => {
    const h = new Date();
    st = { y: ctx.ano, m: ctx.ano === h.getFullYear() ? h.getMonth() : 0, aba: 'agenda', filtro: 'pendente', sujo: false };
    el.innerHTML = `<h1>Diretoria Social</h1>
      <p class="lead">Agenda de eventos da escola e sugestões enviadas pelos estudantes.</p>
      <div class="tabs" role="group" aria-label="Seções da Social">
        <button class="tab" data-aba="agenda" aria-pressed="true">Agenda</button>
        <button class="tab" data-aba="sugestoes" aria-pressed="false">Sugestões</button>
      </div>
      <div id="socialBody"></div><dialog id="dlg" aria-label="Detalhes"></dialog>`;
    el.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      st.aba = b.dataset.aba;
      el.querySelectorAll('.tabs .tab').forEach(t => t.setAttribute('aria-pressed', String(t === b)));
      mostrar();
    });
    dlg().addEventListener('close', () => { if (st.sujo) { st.sujo = false; mostrar(); } });
    mostrar();
  };
  const mostrar = seguro(async () => { if (st.aba === 'agenda') await agenda(); else await sugestoes(); });

  /* ---------- janela (dialog) ---------- */
  function abrir(html, handler) {
    const d = dlg(); d.innerHTML = html;
    d.onclick = seguro(async e => {
      if (e.target === d || e.target.closest('[data-fechar]')) return d.close();
      if (handler) await handler(e);
    });
    if (!d.open) d.showModal();
  }

  /* ---------- agenda ---------- */
  async function agenda() {
    const c = $('#socialBody'); if (!c) return;
    const { y, m } = st, n = new Date(y, m + 1, 0).getDate();
    const rows = ok(await db.from('eventos_datas').select('data, eventos(id,titulo)').gte('data', iso(y, m, 1)).lte('data', iso(y, m, n)));
    if (!$('#socialBody') || st.y !== y || st.m !== m || st.aba !== 'agenda') return; // mudou de tela ou de mês enquanto carregava
    const por = {};
    rows.forEach(r => { if (r.eventos) (por[r.data] = por[r.data] || []).push(r.eventos); });
    const h = new Date(), hj = iso(h.getFullYear(), h.getMonth(), h.getDate());
    let cel = '';
    for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cel += '<div></div>';
    for (let d = 1; d <= n; d++) {
      const dt = iso(y, m, d), evs = por[dt] || [];
      cel += `<button type="button" class="day${dt === hj ? ' hoje' : ''}" data-d="${dt}" aria-label="${d} de ${MESES[m]}: ${evs.length ? pl(evs.length, 'evento', 'eventos') : 'sem eventos'}">
        <span class="n">${d}</span>${evs.slice(0, 2).map(e => `<span class="ev-tag">${esc(e.titulo)}</span>`).join('')}${evs.length > 2 ? `<span class="ev-tag">+${evs.length - 2}</span>` : ''}${evs.length ? '<span class="dot"></span>' : ''}</button>`;
    }
    c.innerHTML = `<div class="cal-head">
        <div class="barra"><button class="btn o sm" data-nav="-1" aria-label="Mês anterior">‹</button><h2 aria-live="polite">${MESES[m]} ${y}</h2><button class="btn o sm" data-nav="1" aria-label="Próximo mês">›</button></div>
        <button class="btn" data-novo>Novo evento</button></div>
      <div class="cal">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(x => `<div class="wd" aria-hidden="true">${x}</div>`).join('')}${cel}</div>`;
    c.onchange = null;
    c.onclick = seguro(async e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { st.m += Number(nav.dataset.nav); if (st.m < 0) { st.m = 11; st.y--; } if (st.m > 11) { st.m = 0; st.y++; } return agenda(); }
      if (e.target.closest('[data-novo]')) return editor(null, { datas: [] });
      const dia = e.target.closest('[data-d]');
      if (dia) return diaDlg(dia.dataset.d, por[dia.dataset.d] || []);
    });
  }

  function diaDlg(dt, evs) {
    abrir(`<div class="dlg"><div class="item" style="border:0;padding-top:0"><h2>${br(dt)}</h2><button class="btn o sm" data-fechar>Fechar</button></div>
      ${evs.length ? evs.map(e => `<div class="item"><span>${esc(e.titulo)}</span><button class="btn o sm" data-abrir="${e.id}">Abrir</button></div>`).join('') : '<p class="lead">Nenhum evento neste dia.</p>'}
      <p style="margin-top:18px"><button class="btn" data-novo>Novo evento neste dia</button></p></div>`, async e => {
      const ab = e.target.closest('[data-abrir]'); if (ab) return editor(ab.dataset.abrir);
      if (e.target.closest('[data-novo]')) return editor(null, { datas: [dt] });
    });
  }

  /* ---------- editor do evento ---------- */
  async function editor(id, pre = {}) {
    let ev = { id: null, titulo: '', categoria: CATS[0], descricao: '', hora_inicio: '', hora_fim: '', local_evento: '', datas: [], ...pre };
    if (id) {
      const e = ok(await db.from('eventos').select('*').eq('id', id).single());
      if (!e) throw new Error('Evento não encontrado.');
      const ds = ok(await db.from('eventos_datas').select('data').eq('evento_id', id).order('data'));
      ev = { ...e, hora_inicio: hhmm(e.hora_inicio), hora_fim: hhmm(e.hora_fim), local_evento: e.local_evento || '', descricao: e.descricao || '', categoria: e.categoria || CATS[0], datas: ds.map(x => x.data) };
    }
    desenhar(ev, 'det');
  }

  function desenhar(ev, sec) {
    const abas = ev.id ? `<div class="tabs" role="group" aria-label="Partes do evento">${[['det', 'Detalhes'], ['rec', 'Recursos'], ['ing', 'Ingressos']]
      .map(([k, t]) => `<button class="tab" data-sec="${k}" aria-pressed="${k === sec}">${t}</button>`).join('')}</div>` : '';
    abrir(`<div class="dlg"><div class="item" style="border:0;padding-top:0"><h2>${ev.id ? esc(ev.titulo) : 'Novo evento'}</h2><button class="btn o sm" data-fechar>Fechar</button></div>
      ${abas}<div id="sec" style="margin-top:18px"></div></div>`, async e => {
      const s = e.target.closest('[data-sec]'); if (s) desenhar(ev, s.dataset.sec);
    });
    seguro(({ det: secDet, rec: secRec, ing: secIng })[sec])(ev);
  }

  function secDet(ev) {
    const s = $('#sec');
    const chips = () => ev.datas.length
      ? ev.datas.map(d => `<span class="chip">${br(d)}<button type="button" class="x" data-rm="${d}" aria-label="Remover o dia ${br(d)}">×</button></span>`).join('')
      : '<span class="lead" style="margin:0">Nenhum dia escolhido ainda.</span>';
    s.innerHTML = `<form id="fev" novalidate>
      <div class="field"><label for="f-t">Título</label><input id="f-t" value="${esc(ev.titulo)}" maxlength="120" required></div>
      <div class="row2">
        <div class="field"><label for="f-c">Categoria</label><select id="f-c">${opts([...new Set([ev.categoria, ...CATS].filter(Boolean))], ev.categoria)}</select></div>
        <div class="field"><label for="f-l">Local</label><input id="f-l" value="${esc(ev.local_evento)}" maxlength="120"></div></div>
      <div class="field"><label for="f-d">Descrição</label><textarea id="f-d" rows="3">${esc(ev.descricao)}</textarea></div>
      <div class="row2">
        <div class="field"><label for="f-i">Início</label><input id="f-i" type="time" value="${ev.hora_inicio}"></div>
        <div class="field"><label for="f-f">Fim</label><input id="f-f" type="time" value="${ev.hora_fim}"></div></div>
      <div class="field"><label for="f-dia">Dias do evento</label>
        <div class="barra"><input id="f-dia" type="date" style="width:auto"><button type="button" class="btn o sm" data-add>Adicionar dia</button></div>
        <div class="chips">${chips()}</div></div>
      <div class="barra" style="justify-content:space-between"><button class="btn" type="submit">Salvar evento</button>
        ${ev.id ? '<button type="button" class="btn o sm" data-del>Excluir evento</button>' : ''}</div></form>`;
    const ler = () => {
      ev.titulo = $('#f-t').value; ev.categoria = $('#f-c').value; ev.local_evento = $('#f-l').value;
      ev.descricao = $('#f-d').value; ev.hora_inicio = $('#f-i').value; ev.hora_fim = $('#f-f').value;
    };
    s.onclick = seguro(async e => {
      if (e.target.closest('[data-add]')) {
        const v = $('#f-dia').value; if (!v) return toast('Escolha uma data antes de adicionar.');
        ler(); if (!ev.datas.includes(v)) ev.datas = [...ev.datas, v].sort(); return secDet(ev);
      }
      const rm = e.target.closest('[data-rm]');
      if (rm) { ler(); ev.datas = ev.datas.filter(d => d !== rm.dataset.rm); return secDet(ev); }
      if (e.target.closest('[data-del]')) {
        if (!confirm('Excluir este evento e tudo o que está ligado a ele (recursos e ingressos)?')) return;
        ok(await db.from('eventos').delete().eq('id', ev.id));
        st.sujo = true; toast('Evento excluído.'); dlg().close();
      }
    });
    s.onsubmit = seguro(async e => {
      e.preventDefault(); ler();
      if (!ev.titulo.trim()) return toast('Dê um título ao evento.');
      if (!ev.datas.length) return toast('Escolha ao menos um dia.');
      ev.id = ok(await db.rpc('salvar_evento', {
        p_id: ev.id || null, p_titulo: ev.titulo.trim(), p_categoria: ev.categoria, p_descricao: ev.descricao.trim() || null,
        p_inicio: ev.hora_inicio || null, p_fim: ev.hora_fim || null, p_local: ev.local_evento.trim() || null, p_datas: ev.datas
      }));
      st.sujo = true; toast('Evento salvo.'); desenhar(ev, 'det');
    });
  }

  async function secRec(ev) {
    const s = $('#sec');
    const lista = ok(await db.from('eventos_recursos').select('*').eq('evento_id', ev.id).order('criado_em'));
    if ($('#sec') !== s) return;
    s.innerHTML = `<form id="frec" class="barra" novalidate>
        <div class="field" style="flex:2;margin:0;min-width:150px"><label for="r-n">Recurso</label><input id="r-n" maxlength="100" required></div>
        <div class="field" style="width:90px;margin:0"><label for="r-q">Qtd.</label><input id="r-q" type="number" min="1" value="1"></div>
        <div class="field" style="flex:1;margin:0;min-width:120px"><label for="r-r">Responsável</label><input id="r-r" maxlength="80"></div>
        <button class="btn" type="submit">Adicionar</button></form>
      <div style="margin-top:18px">${lista.length ? lista.map(r => `<div class="item">
        <span><b>${esc(r.nome)}</b> × ${r.quantidade}${r.responsavel ? ' · ' + esc(r.responsavel) : ''}</span>
        <span class="barra" style="align-items:center"><span class="pill${r.status === 'providenciado' ? ' ok' : ''}">${r.status === 'providenciado' ? 'Providenciado' : 'Pendente'}</span>
          <button class="btn o sm" data-tg="${r.id}" data-st="${r.status}">${r.status === 'providenciado' ? 'Reabrir' : 'Marcar providenciado'}</button>
          <button class="btn o sm" data-rm="${r.id}" aria-label="Remover ${esc(r.nome)}">Remover</button></span></div>`).join('')
        : '<p class="lead">Nenhum recurso ainda. Liste o que o evento precisa: som, cadeiras, decoração.</p>'}</div>`;
    s.onsubmit = seguro(async e => {
      e.preventDefault(); const nome = $('#r-n').value.trim();
      if (!nome) return toast('Diga qual recurso o evento precisa.');
      ok(await db.from('eventos_recursos').insert({ evento_id: ev.id, nome, quantidade: Math.max(1, Math.floor(Number($('#r-q').value)) || 1), responsavel: $('#r-r').value.trim() || null }));
      secRec(ev);
    });
    s.onclick = seguro(async e => {
      const t = e.target.closest('[data-tg]');
      if (t) { ok(await db.from('eventos_recursos').update({ status: t.dataset.st === 'providenciado' ? 'pendente' : 'providenciado' }).eq('id', t.dataset.tg)); return secRec(ev); }
      const r = e.target.closest('[data-rm]');
      if (r) { ok(await db.from('eventos_recursos').delete().eq('id', r.dataset.rm)); return secRec(ev); }
    });
    s.onchange = null;
  }

  async function secIng(ev) {
    const s = $('#sec');
    const lista = ok(await db.from('ingressos').select('*').eq('evento_id', ev.id).order('criado_em'));
    if ($('#sec') !== s) return;
    const pagos = lista.filter(i => i.pago);
    s.innerHTML = `<div class="stats"><div><b>${lista.length}</b>ingressos</div><div><b>${pagos.length}</b>pagos</div>
        <div><b>${lista.filter(i => i.retirado).length}</b>retirados</div><div><b>${brl(pagos.reduce((a, i) => a + Number(i.valor), 0))}</b>arrecadado</div></div>
      <form id="fing" class="barra" novalidate>
        <div class="field" style="flex:2;margin:0;min-width:150px"><label for="i-n">Participante</label><input id="i-n" maxlength="100" required></div>
        <div class="field" style="flex:1;margin:0;min-width:90px"><label for="i-t">Turma</label><input id="i-t" maxlength="40"></div>
        <div class="field" style="width:110px;margin:0"><label for="i-v">Valor (R$)</label><input id="i-v" type="number" min="0" step="0.01" value="0"></div>
        <button class="btn" type="submit">Adicionar</button></form>
      <div style="overflow-x:auto;margin-top:18px"><table class="tbl"><thead><tr><th>Participante</th><th>Turma</th><th>Valor</th><th>Pago</th><th>Retirado</th><th></th></tr></thead><tbody>
        ${lista.length ? lista.map(i => `<tr><td>${esc(i.nome)}</td><td>${esc(i.turma || '—')}</td><td>${brl(i.valor)}</td>
          <td><input type="checkbox" data-ck="pago" data-id="${i.id}" ${i.pago ? 'checked' : ''} aria-label="Pago: ${esc(i.nome)}"></td>
          <td><input type="checkbox" data-ck="retirado" data-id="${i.id}" ${i.retirado ? 'checked' : ''} aria-label="Retirado: ${esc(i.nome)}"></td>
          <td><button class="btn o sm" data-rm="${i.id}" aria-label="Remover ${esc(i.nome)}">Remover</button></td></tr>`).join('')
          : '<tr><td colspan="6">Nenhum ingresso registrado. Adicione cada participante acima.</td></tr>'}</tbody></table></div>`;
    s.onsubmit = seguro(async e => {
      e.preventDefault(); const nome = $('#i-n').value.trim();
      if (!nome) return toast('Informe o nome do participante.');
      ok(await db.from('ingressos').insert({ evento_id: ev.id, nome, turma: $('#i-t').value.trim() || null, valor: Math.max(0, Number($('#i-v').value) || 0) }));
      secIng(ev);
    });
    s.onchange = seguro(async e => {
      const c = e.target.closest('[data-ck]'); if (!c) return;
      ok(await db.from('ingressos').update({ [c.dataset.ck]: c.checked }).eq('id', c.dataset.id)); secIng(ev);
    });
    s.onclick = seguro(async e => {
      const r = e.target.closest('[data-rm]'); if (!r) return;
      if (!confirm('Remover este ingresso?')) return;
      ok(await db.from('ingressos').delete().eq('id', r.dataset.rm)); secIng(ev);
    });
  }

  /* ---------- sugestões dos estudantes ---------- */
  async function sugestoes() {
    const c = $('#socialBody'); if (!c) return;
    const filtro = st.filtro;
    const rows = ok(await db.from('sugestoes_eventos').select('*').eq('status', filtro).order('criado_em', { ascending: false }));
    if (!$('#socialBody') || st.aba !== 'sugestoes') return;
    const nomes = { pendente: 'Pendentes', aprovada: 'Aprovadas', arquivada: 'Arquivadas' };
    const acoes = r => r.status === 'pendente'
      ? `<button class="btn sm" data-set="aprovada" data-id="${r.id}">Aprovar</button><button class="btn o sm" data-set="arquivada" data-id="${r.id}">Arquivar</button><button class="btn o sm" data-virar="${r.id}">Virar evento</button>`
      : r.status === 'aprovada'
        ? `<button class="btn o sm" data-virar="${r.id}">Virar evento</button><button class="btn o sm" data-set="arquivada" data-id="${r.id}">Arquivar</button>`
        : `<button class="btn o sm" data-set="pendente" data-id="${r.id}">Reabrir</button>`;
    c.innerHTML = `<div class="cal-head"><h2>Sugestões dos estudantes</h2>
        <div><label for="s-f" class="sr">Mostrar</label><select id="s-f" style="width:auto">${Object.keys(nomes).map(k => `<option value="${k}"${k === filtro ? ' selected' : ''}>${nomes[k]}</option>`).join('')}</select></div></div>
      ${rows.length ? rows.map(r => `<article class="card" style="margin-top:12px"><p>${esc(r.texto)}</p>
        <p class="lead" style="margin-top:6px;font-size:.85rem">${r.anonimo ? 'Anônimo' : esc(r.autor_nome || 'Estudante') + (r.autor_turma ? ' · ' + esc(r.autor_turma) : '')} · ${new Date(r.criado_em).toLocaleDateString('pt-BR')}</p>
        <div class="barra" style="margin-top:12px">${acoes(r)}</div></article>`).join('')
        : `<p class="lead">${filtro === 'pendente' ? 'Nenhuma sugestão pendente. Quando os estudantes enviarem ideias pelo site, elas aparecem aqui.' : 'Nada nesta lista.'}</p>`}`;
    c.onchange = seguro(async e => { if (e.target.id === 's-f') { st.filtro = e.target.value; await sugestoes(); } });
    c.onclick = seguro(async e => {
      const a = e.target.closest('[data-set]');
      if (a) { ok(await db.from('sugestoes_eventos').update({ status: a.dataset.set }).eq('id', a.dataset.id)); return sugestoes(); }
      const v = e.target.closest('[data-virar]');
      if (v) { const r = rows.find(x => x.id === v.dataset.virar); if (r) return editor(null, { titulo: r.texto.slice(0, 80), descricao: r.texto, datas: [] }); }
    });
  }

  /* ---------- números no painel geral ---------- */
  mod.metrica = async () => {
    const h = new Date(), d = iso(h.getFullYear(), h.getMonth(), h.getDate());
    const [a, b] = await Promise.all([
      db.from('eventos_datas').select('evento_id').gte('data', d),
      db.from('sugestoes_eventos').select('id', { count: 'exact', head: true }).eq('status', 'pendente')
    ]);
    const futuros = new Set(ok(a).map(x => x.evento_id)).size;
    return `${pl(futuros, 'evento futuro', 'eventos futuros')} · ${pl(b.count ?? 0, 'sugestão pendente', 'sugestões pendentes')}`;
  };
})();
