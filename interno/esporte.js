'use strict';
/* =====================================================================
   Grêmio · esporte.js — Diretoria do Esporte
   Torneios gerais (grupos ou mata-mata), resultados e credenciais de juízes.
   Sorteio, chaveamento e avanço de fases rodam no banco (06_esporte.sql).
   Depende de core.js (db, $, esc, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'esporte');
  if (!mod) return;

  const FMT = { eliminatoria: 'Mata-mata', grupos: 'Fase de grupos e mata-mata' };
  const TST = { em_andamento: ['Em andamento', 'wip'], encerrado: ['Encerrado', 'ok'] };
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const br = d => (d ? d.split('-').reverse().join('/') : '');
  const nomeRodada = (r, total) => ({ 0: 'Final', 1: 'Semifinal', 2: 'Quartas de final', 3: 'Oitavas de final' }[total - r] || 'Rodada ' + r);
  const dlg = () => $('#dlg');
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const p2 = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
  const hhmm = t => (t ? t.slice(0, 5) : '');
  let st = null;

  mod.render = el => {
    const h = new Date();
    st = { aba: 'torneios', y: ctx.ano, m: ctx.ano === h.getFullYear() ? h.getMonth() : 0, filtro: 'pendente' };
    el.innerHTML = `<h1>Diretoria do Esporte</h1>
      <p class="lead">Torneios de qualquer esporte, com sorteio automático, e credenciais para os juízes.</p>
      <div class="tabs" role="group" aria-label="Seções do Esporte">
        <button class="tab" data-aba="torneios" aria-pressed="true">Torneios</button>
        <button class="tab" data-aba="agenda" aria-pressed="false">Agenda</button>
        <button class="tab" data-aba="sugestoes" aria-pressed="false">Sugestões</button>
        <button class="tab" data-aba="juizes" aria-pressed="false">Juízes</button>
      </div><div id="espBody"></div><dialog id="dlg" aria-label="Detalhes"></dialog>`;
    el.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      st.aba = b.dataset.aba;
      el.querySelectorAll('.tabs .tab').forEach(t => t.setAttribute('aria-pressed', String(t === b)));
      mostrar();
    });
    mostrar();
  };
  const mostrar = seguro(async () => { await ({ torneios, agenda, sugestoes, juizes })[st.aba](); });

  function abrir(html, handler, aoFechar) {
    const d = dlg(); d.innerHTML = html; d.onsubmit = null;
    d.onclick = seguro(async e => { if (e.target === d || e.target.closest('[data-fechar]')) return d.close(); if (handler) await handler(e); });
    d.onclose = aoFechar || null;
    if (!d.open) d.showModal();
  }
  const cab = t => `<div class="item" style="border:0;padding-top:0"><h2>${esc(t)}</h2><button class="btn o sm" data-fechar>Fechar</button></div>`;

  /* ---------- lista de torneios ---------- */
  async function torneios() {
    const c = $('#espBody'); if (!c) return;
    const rows = ok(await db.from('esp_torneios').select('*, esp_equipes(count)').order('criado_em', { ascending: false }).limit(100));
    if (!$('#espBody') || st.aba !== 'torneios') return;
    c.innerHTML = `<div class="cal-head"><h2>Torneios</h2><button class="btn" data-novo>Novo torneio</button></div>
      ${rows.length ? rows.map(t => `<article class="card" style="margin-top:12px"><div class="item" style="border:0;padding:0"><b>${esc(t.nome)}</b><span class="pill ${TST[t.status][1]}">${TST[t.status][0]}</span></div>
        <p class="lead" style="margin-top:4px;font-size:.85rem">${esc(t.esporte || 'Esporte não informado')} · ${FMT[t.formato]} · ${t.esp_equipes?.[0]?.count ?? 0} equipes</p>
        <div class="barra" style="margin-top:12px"><button class="btn o sm" data-abrir="${t.id}">Abrir chaveamento</button><button class="btn o sm" data-rm="${t.id}" aria-label="Excluir ${esc(t.nome)}">Excluir</button></div></article>`).join('')
        : '<p class="lead">Nenhum torneio ainda. Clique em "Novo torneio", informe as equipes e o chaveamento é montado na hora.</p>'}`;
    c.onclick = seguro(async e => {
      if (e.target.closest('[data-novo]')) return novo();
      const a = e.target.closest('[data-abrir]'); if (a) return detalhe(a.dataset.abrir);
      const r = e.target.closest('[data-rm]');
      if (r && confirm('Excluir este torneio, as equipes e todos os jogos?')) { ok(await db.from('esp_torneios').delete().eq('id', r.dataset.rm)); await torneios(); }
    });
  }

  function novo(pre = '') {
    abrir(`<div class="dlg">${cab('Novo torneio')}<form id="fnt" novalidate>
      <div class="row2"><div class="field"><label for="n-n">Nome do torneio</label><input id="n-n" maxlength="100" value="${esc(pre)}" required></div>
        <div class="field"><label for="n-e">Esporte ou modalidade</label><input id="n-e" maxlength="60" placeholder="Futsal, vôlei, xadrez, jogo virtual…"></div></div>
      <div class="field"><label for="n-f">Formato</label><select id="n-f"><option value="eliminatoria">Mata-mata direto</option><option value="grupos">Fase de grupos e depois mata-mata</option></select></div>
      <div class="row2" id="n-g" hidden><div class="field"><label for="n-ng">Quantos grupos</label><input id="n-ng" type="number" min="1" max="8" value="2"></div>
        <div class="field"><label for="n-c">Quantos avançam por grupo</label><input id="n-c" type="number" min="1" max="4" value="2"></div></div>
      <div class="field"><label for="n-q">Equipes (uma por linha)</label><textarea id="n-q" rows="6" required></textarea></div>
      <button class="btn" type="submit">Sortear e criar</button></form></div>`);
    $('#n-f').onchange = () => { $('#n-g').hidden = $('#n-f').value !== 'grupos'; };
    dlg().onsubmit = seguro(async e => {
      e.preventDefault();
      const nome = $('#n-n').value.trim(); if (!nome) return toast('Dê um nome ao torneio.');
      const eq = $('#n-q').value.split('\n').map(x => x.trim()).filter(Boolean);
      const id = ok(await db.rpc('esp_criar_torneio', { p_nome: nome, p_esporte: $('#n-e').value, p_formato: $('#n-f').value,
        p_grupos: Number($('#n-ng').value) || 1, p_class: Number($('#n-c').value) || 2, p_equipes: eq }));
      toast('Torneio criado e sorteado.'); await torneios(); await detalhe(id);
    });
  }

  /* ---------- chaveamento e resultados ---------- */
  async function detalhe(id) {
    const [t, eq, jg, ju] = await Promise.all([
      db.from('esp_torneios').select('*').eq('id', id).single(), db.from('esp_equipes').select('*').eq('torneio_id', id),
      db.from('esp_jogos').select('*').eq('torneio_id', id).order('fase').order('rodada').order('ordem'), db.from('esp_juizes').select('id,nome')
    ]).then(a => a.map(ok));
    const cls = t.formato === 'grupos' ? ok(await db.rpc('esp_classificacao', { p_id: id })) : [];
    const nome = Object.fromEntries(eq.map(x => [x.id, x.nome])), juiz = Object.fromEntries(ju.map(x => [x.id, x.nome]));
    const grupos = jg.filter(j => j.fase === 'grupos'), mata = jg.filter(j => j.fase === 'eliminatoria');
    const rodadas = [...new Set(mata.map(j => j.rodada))], totalR = rodadas.length ? Math.max(...rodadas) : 0;
    const linha = j => {
      const bye = j.equipe_a && !j.equipe_b && j.status === 'encerrado';
      const A = j.equipe_a ? esc(nome[j.equipe_a]) : 'A definir', B = bye ? '(avança direto)' : j.equipe_b ? esc(nome[j.equipe_b]) : 'A definir';
      const pronto = j.equipe_a && j.equipe_b;
      return `<tr data-j="${j.id}"><td><b>${A}</b> × <b>${B}</b>${j.juiz_id ? `<br><small>Apitado por ${esc(juiz[j.juiz_id] || 'juiz')}</small>` : ''}</td>
        ${bye ? '<td colspan="3">—</td><td></td>' : `<td style="white-space:nowrap"><input class="pa" type="number" min="0" aria-label="Placar de ${A}" value="${j.placar_a ?? ''}" style="width:64px"${pronto ? '' : ' disabled'}> × <input class="pb" type="number" min="0" aria-label="Placar de ${B}" value="${j.placar_b ?? ''}" style="width:64px"${pronto ? '' : ' disabled'}>
          ${j.fase === 'eliminatoria' && pronto ? `<br><select class="pv" aria-label="Vencedor nos pênaltis, se empatar" style="margin-top:6px"><option value="">Vencedor se empatar…</option><option value="${j.equipe_a}"${j.vencedor === j.equipe_a ? ' selected' : ''}>${A}</option><option value="${j.equipe_b}"${j.vencedor === j.equipe_b ? ' selected' : ''}>${B}</option></select>` : ''}</td>
          <td><input class="jd" type="date" aria-label="Data do jogo" value="${j.data || ''}"><input class="jh" type="time" aria-label="Hora do jogo" value="${(j.hora || '').slice(0, 5)}" style="margin-top:6px"></td>
          <td><input class="jl" maxlength="80" aria-label="Local do jogo" value="${esc(j.local || '')}"></td>
          <td><button class="btn sm" data-salvar="${j.id}">Salvar</button></td>`}</tr>`;
    };
    const tabela = js => `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Jogo</th><th>Placar</th><th>Data e hora</th><th>Local</th><th></th></tr></thead><tbody>${js.map(linha).join('')}</tbody></table></div>`;
    const podeAvancar = t.formato === 'grupos' && !mata.length && grupos.length && grupos.every(j => j.status === 'encerrado');
    abrir(`<div class="dlg">${cab(t.nome)}
      <p class="lead" style="margin-top:0">${esc(t.esporte || '')} · ${FMT[t.formato]} · <span class="pill ${TST[t.status][1]}">${TST[t.status][0]}</span>${t.campeao ? ` · <b>Campeão: ${esc(nome[t.campeao] || '')}</b>` : ''}</p>
      ${t.formato === 'grupos' ? [...new Set(cls.map(c => c.grupo))].map(g => `<h3 style="margin-top:22px">Grupo ${g}</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Equipe</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>Pts</th></tr></thead><tbody>
        ${cls.filter(c => c.grupo === g).map((c, i) => `<tr><td>${i < t.classificam ? '<b>' : ''}${esc(c.nome)}${i < t.classificam ? '</b>' : ''}</td><td>${c.j}</td><td>${c.v}</td><td>${c.e}</td><td>${c.d}</td><td>${c.sg}</td><td>${c.pts}</td></tr>`).join('')}</tbody></table></div>`).join('') : ''}
      ${grupos.length ? `<h3 style="margin-top:26px">Jogos dos grupos</h3>${tabela(grupos)}` : ''}
      ${t.formato === 'grupos' && !mata.length ? `<p style="margin-top:18px">${podeAvancar ? '<button class="btn" data-avancar>Gerar mata-mata</button>' : '<span class="lead">O mata-mata é gerado quando todos os jogos dos grupos terminarem. Destacados em negrito: quem avança hoje.</span>'}</p>` : ''}
      ${rodadas.map(r => `<h3 style="margin-top:26px">${nomeRodada(r, totalR)}</h3>${tabela(mata.filter(j => j.rodada === r))}`).join('')}</div>`, async e => {
      if (e.target.closest('[data-avancar]')) { ok(await db.rpc('esp_avancar_fase', { p_id: id })); toast('Mata-mata gerado.'); return detalhe(id); }
      const b = e.target.closest('[data-salvar]'); if (!b) return;
      const tr = b.closest('tr'), q = s => tr.querySelector(s);
      const upd = ok(await db.from('esp_jogos').update({ data: q('.jd').value || null, hora: q('.jh').value || null, local: q('.jl').value.trim() || null }).eq('id', b.dataset.salvar).select('id'));
      if (!upd.length) throw new Error('Sem permissão para alterar este jogo.');
      const pa = q('.pa').value, pb = q('.pb').value;
      if (pa !== '' || pb !== '') {
        if (pa === '' || pb === '') throw new Error('Preencha os dois placares.');
        ok(await db.rpc('esp_registrar_resultado', { p_jogo: b.dataset.salvar, p_a: Number(pa), p_b: Number(pb), p_vencedor: q('.pv')?.value || null }));
      }
      toast('Jogo salvo.'); return detalhe(id);
    }, () => { if (st.aba !== 'juizes') mostrar(); });
  }

  /* ---------- agenda: jogos que já têm data (clique abre o torneio) ---------- */
  async function agenda() {
    const c = $('#espBody'); if (!c) return;
    const { y, m } = st, n = new Date(y, m + 1, 0).getDate();
    const rows = ok(await db.from('esp_jogos').select('id,data,hora,torneio_id,equipe_a,equipe_b,esp_torneios(nome)').gte('data', iso(y, m, 1)).lte('data', iso(y, m, n)).order('hora'));
    const ids = [...new Set(rows.flatMap(r => [r.equipe_a, r.equipe_b]).filter(Boolean))];
    const eq = ids.length ? Object.fromEntries(ok(await db.from('esp_equipes').select('id,nome').in('id', ids)).map(x => [x.id, x.nome])) : {};
    if (!$('#espBody') || st.aba !== 'agenda' || st.y !== y || st.m !== m) return;
    const por = {};
    rows.forEach(r => { (por[r.data] = por[r.data] || []).push({ ...r, nome: `${eq[r.equipe_a] || 'A definir'} × ${eq[r.equipe_b] || 'A definir'}` }); });
    const h = new Date(), hj = iso(h.getFullYear(), h.getMonth(), h.getDate());
    let cel = '';
    for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cel += '<div></div>';
    for (let d = 1; d <= n; d++) {
      const dt = iso(y, m, d), js = por[dt] || [], cls = `day${dt === hj ? ' hoje' : ''}${js.length ? '' : ' vazio'}`;
      const tags = js.slice(0, 2).map(j => `<span class="ev-tag">${esc((j.hora ? hhmm(j.hora) + ' ' : '') + j.nome)}</span>`).join('') + (js.length > 2 ? `<span class="ev-tag">+${js.length - 2}</span>` : '') + (js.length ? '<span class="dot"></span>' : '');
      cel += js.length
        ? `<button type="button" class="${cls}" data-d="${dt}" aria-label="${d} de ${MESES[m]}: ${js.length} ${js.length === 1 ? 'jogo' : 'jogos'}"><span class="n">${d}</span>${tags}</button>`
        : `<div class="${cls}"><span class="n">${d}</span></div>`;
    }
    c.innerHTML = `<div class="cal-head">
        <div class="barra"><button class="btn o sm" data-nav="-1" aria-label="Mês anterior">‹</button><h2 aria-live="polite">${MESES[m]} ${y}</h2><button class="btn o sm" data-nav="1" aria-label="Próximo mês">›</button></div>
        <button class="btn" data-novo>Novo torneio</button></div>
      <div class="cal">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(x => `<div class="wd" aria-hidden="true">${x}</div>`).join('')}${cel}</div>
      ${rows.length ? '' : '<p class="lead">Nenhum jogo com data neste mês. Defina data e hora nos jogos de cada torneio e eles aparecem aqui.</p>'}`;
    c.onchange = null;
    c.onclick = seguro(async e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { st.m += Number(nav.dataset.nav); if (st.m < 0) { st.m = 11; st.y--; } if (st.m > 11) { st.m = 0; st.y++; } return agenda(); }
      if (e.target.closest('[data-novo]')) return novo();
      const dia = e.target.closest('[data-d]'); if (dia) diaDlg(dia.dataset.d, por[dia.dataset.d] || []);
    });
  }

  function diaDlg(dt, jogos) {
    abrir(`<div class="dlg">${cab(dt.split('-').reverse().join('/'))}
      ${jogos.map(j => `<div class="item"><span><b>${esc(j.esp_torneios?.nome || 'Torneio')}</b><br>${j.hora ? hhmm(j.hora) + ' · ' : ''}${esc(j.nome)}</span><button class="btn o sm" data-abrir="${j.torneio_id}">Abrir torneio</button></div>`).join('')}</div>`,
      async e => { const a = e.target.closest('[data-abrir]'); if (a) await detalhe(a.dataset.abrir); });
  }

  /* ---------- sugestões dos estudantes ---------- */
  async function sugestoes() {
    const c = $('#espBody'); if (!c) return;
    const f = st.filtro;
    const rows = ok(await db.from('esp_sugestoes').select('*').eq('status', f).order('criado_em', { ascending: false }).limit(200));
    if (!$('#espBody') || st.aba !== 'sugestoes') return;
    const nomes = { pendente: 'Pendentes', aprovada: 'Aprovadas', arquivada: 'Arquivadas' };
    const acoes = r => r.status === 'pendente'
      ? `<button class="btn sm" data-set="aprovada" data-id="${r.id}">Aprovar</button><button class="btn o sm" data-set="arquivada" data-id="${r.id}">Arquivar</button><button class="btn o sm" data-virar="${r.id}">Virar torneio</button>`
      : r.status === 'aprovada'
        ? `<button class="btn o sm" data-virar="${r.id}">Virar torneio</button><button class="btn o sm" data-set="arquivada" data-id="${r.id}">Arquivar</button>`
        : `<button class="btn o sm" data-set="pendente" data-id="${r.id}">Reabrir</button>`;
    c.innerHTML = `<div class="cal-head"><h2>Sugestões dos estudantes</h2>
        <div><label for="s-f" class="sr">Mostrar</label><select id="s-f" style="width:auto">${Object.keys(nomes).map(k => `<option value="${k}"${k === f ? ' selected' : ''}>${nomes[k]}</option>`).join('')}</select></div></div>
      ${rows.length ? rows.map(r => `<article class="card" style="margin-top:12px"><p>${esc(r.texto)}</p>
        <p class="lead" style="margin-top:6px;font-size:.85rem">${r.anonimo ? 'Anônimo' : esc(r.autor_nome || 'Estudante') + (r.autor_turma ? ' · ' + esc(r.autor_turma) : '')} · ${new Date(r.criado_em).toLocaleDateString('pt-BR')}</p>
        <div class="barra" style="margin-top:12px">${acoes(r)}</div></article>`).join('')
        : `<p class="lead">${f === 'pendente' ? 'Nenhuma sugestão pendente. Quando os estudantes enviarem ideias pelo site, elas aparecem aqui.' : 'Nada nesta lista.'}</p>`}`;
    c.onchange = seguro(async e => { if (e.target.id === 's-f') { st.filtro = e.target.value; await sugestoes(); } });
    c.onclick = seguro(async e => {
      const a = e.target.closest('[data-set]');
      if (a) { ok(await db.from('esp_sugestoes').update({ status: a.dataset.set }).eq('id', a.dataset.id)); return sugestoes(); }
      const v = e.target.closest('[data-virar]');
      if (v) { const r = rows.find(x => x.id === v.dataset.virar); if (r) novo(r.texto.slice(0, 100)); }
    });
  }

  /* ---------- credenciais de juízes ---------- */
  async function juizes() {
    const c = $('#espBody'); if (!c) return;
    const rows = ok(await db.from('esp_juizes').select('*').order('criado_em', { ascending: false }));
    if (!$('#espBody') || st.aba !== 'juizes') return;
    c.innerHTML = `<form id="fju" class="barra" style="margin-top:22px" novalidate>
        <div class="field" style="flex:1;margin:0;min-width:220px"><label for="j-n">Nome do juiz</label><input id="j-n" maxlength="80" required></div>
        <button class="btn" type="submit">Gerar credencial</button></form>
      <div style="overflow-x:auto;margin-top:18px"><table class="tbl"><thead><tr><th>Juiz</th><th>Código</th><th>Situação</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map(j => `<tr><td>${esc(j.nome)}</td><td style="font:600 1.05rem ui-monospace,Consolas,monospace;letter-spacing:.12em">${esc(j.codigo)}</td>
        <td><span class="pill ${j.ativo ? 'ok' : 'late'}">${j.ativo ? 'Ativa' : 'Revogada'}</span></td>
        <td><button class="btn o sm" data-tg="${j.id}" data-a="${j.ativo}">${j.ativo ? 'Revogar' : 'Reativar'}</button></td></tr>`).join('')
        : '<tr><td colspan="4">Nenhuma credencial. Gere uma para cada juiz e passe o código a ele.</td></tr>'}</tbody></table></div>`;
    c.onsubmit = seguro(async e => {
      e.preventDefault(); const n = $('#j-n').value.trim(); if (n.length < 2) return toast('Informe o nome do juiz.');
      const j = ok(await db.rpc('esp_criar_juiz', { p_nome: n })); toast(`Credencial de ${j.nome}: ${j.codigo}`); await juizes();
    });
    c.onclick = seguro(async e => {
      const b = e.target.closest('[data-tg]'); if (!b) return;
      ok(await db.from('esp_juizes').update({ ativo: b.dataset.a !== 'true' }).eq('id', b.dataset.tg)); await juizes();
    });
  }

  mod.metrica = async () => {
    const [a, b] = await Promise.all([
      db.from('esp_torneios').select('id', { count: 'exact', head: true }).eq('status', 'em_andamento'),
      db.from('esp_sugestoes').select('id', { count: 'exact', head: true }).eq('status', 'pendente')]);
    if (a.error) throw new Error(a.error.message);
    const t = a.count ?? 0, s = b.count ?? 0;
    return `${t} ${t === 1 ? 'torneio em andamento' : 'torneios em andamento'} · ${s} ${s === 1 ? 'sugestão pendente' : 'sugestões pendentes'}`;
  };
})();
