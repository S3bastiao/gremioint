'use strict';
/* =====================================================================
   Grêmio · monitoria.js — Conecta Monitoria
   Presidência: cria monitorias e dá acesso a monitores e professores.
   Monitor: horários, local, conteúdos, atendimentos e conversa com os estudantes.
   Professor: acompanha conteúdos e dúvidas (sem ver quem perguntou) e orienta.
   As regras de verdade estão no banco (08_monitoria.sql).
   Depende de core.js (db, $, esc, ctx, toast, MODULOS).
   ===================================================================== */
(() => {
  const mod = MODULOS.find(m => m.id === 'monitoria');
  if (!mod) return;

  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DST = { aberta: ['Aberta', ''], respondida: ['Respondida', 'wip'], encerrada: ['Encerrada', 'ok'] };
  const FUN = { monitor: 'Monitor', professor: 'Professor' };
  const dia = d => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
  const dth = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const hhmm = t => (t ? t.slice(0, 5) : '');
  const hoje = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`; };
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const seguro = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Não foi possível concluir: ' + e.message); } };
  const pill = k => `<span class="pill ${DST[k]?.[1] || ''}">${DST[k]?.[0] || esc(k)}</span>`;
  const cab = (t, btn = 'data-fechar', rot = 'Fechar') => `<div class="item" style="border:0;padding-top:0"><h2>${esc(t)}</h2><button class="btn o sm" ${btn}>${rot}</button></div>`;
  const dlg = () => $('#dlg');
  let st = null;

  mod.render = el => {
    st = { admin: ctx.papeis.has('admin'), meu: {}, sujo: false };
    el.innerHTML = `<h1>Conecta Monitoria</h1>
      <p class="lead">Dias, horários e locais das monitorias num só lugar, com dúvidas e conversa entre estudantes e monitores.</p>
      <div id="monBody"></div><dialog id="dlg" aria-label="Monitoria"></dialog>`;
    dlg().addEventListener('close', () => { if (st.sujo) { st.sujo = false; lista(); } });
    seguro(lista)();
  };

  function abrir(html, handler) {
    const d = dlg(); d.innerHTML = html; d.onsubmit = null;
    d.onclick = seguro(async e => {
      if (e.target === d || e.target.closest('[data-fechar]')) return d.close();
      if (handler) await handler(e);
    });
    if (!d.open) d.showModal();
  }

  /* ---------- lista de monitorias ---------- */
  async function lista() {
    const c = $('#monBody'); if (!c) return;
    const [ms, eq] = await Promise.all([db.from('mon_monitorias').select('*').order('disciplina'), db.from('mon_equipe').select('monitoria_id,funcao,user_id,nome')]).then(a => a.map(ok));
    if (!$('#monBody')) return;
    st.meu = {}; eq.filter(e => e.user_id === ctx.user.id).forEach(e => { st.meu[e.monitoria_id] = e.funcao; });
    const vis = st.admin ? ms : ms.filter(m => st.meu[m.id]);
    c.innerHTML = `${st.admin ? '<div class="cal-head"><h2>Monitorias</h2><button class="btn" data-novo>Nova monitoria</button></div>' : '<div style="height:22px"></div>'}
      ${vis.length ? `<div class="grid" style="margin-top:0">${vis.map(m => {
        const nomes = eq.filter(e => e.monitoria_id === m.id && e.funcao === 'monitor').map(e => e.nome).filter(Boolean).join(', ');
        return `<article class="card" style="display:grid;gap:8px;align-content:start"><div class="item" style="border:0;padding:0"><h3>${esc(m.disciplina)}</h3>${m.ativo ? '<span class="pill ok">Visível</span>' : '<span class="pill">Oculta</span>'}</div>
          <p class="lead" style="margin:0;font-size:.88rem">${esc(m.local_atend || 'Local não informado')}${nomes ? ' · ' + esc(nomes) : ''}</p>
          ${!st.admin ? `<p class="lead" style="margin:0;font-size:.82rem">Você é ${FUN[st.meu[m.id]].toLowerCase()} desta monitoria.</p>` : ''}
          <div><button class="btn o sm" data-abrir="${m.id}">Abrir</button></div></article>`; }).join('')}</div>`
        : `<p class="lead">${st.admin ? 'Nenhuma monitoria ainda. Clique em "Nova monitoria", depois dê acesso ao monitor e ao professor na aba Equipe.' : 'Você ainda não está em nenhuma monitoria. Peça à presidência para vincular você.'}</p>`}`;
    c.onclick = seguro(async e => {
      if (e.target.closest('[data-novo]')) return nova();
      const a = e.target.closest('[data-abrir]'); if (a) await detalhe(a.dataset.abrir);
    });
  }

  function nova() {
    abrir(`<div class="dlg">${cab('Nova monitoria')}<form id="fnm" novalidate>
      <div class="field"><label for="n-d">Disciplina</label><input id="n-d" maxlength="80" required></div>
      <div class="field"><label for="n-l">Local do atendimento</label><input id="n-l" maxlength="120"></div>
      <button class="btn" type="submit">Criar monitoria</button></form></div>`);
    dlg().onsubmit = seguro(async e => {
      e.preventDefault(); const d = $('#n-d').value.trim(); if (d.length < 2) return toast('Informe a disciplina.');
      const m = ok(await db.from('mon_monitorias').insert({ disciplina: d, local_atend: $('#n-l').value.trim() || null }).select('id').single());
      toast('Monitoria criada. Agora dê acesso ao monitor e ao professor.'); await lista(); await detalhe(m.id, 'eq');
    });
  }

  /* ---------- janela da monitoria ---------- */
  async function detalhe(id, sec = 'info') {
    const m = ok(await db.from('mon_monitorias').select('*').eq('id', id).single());
    const papel = st.admin ? 'admin' : st.meu[id];
    if (!papel) throw new Error('Você não faz parte desta monitoria.');
    const abas = [['info', 'Informações'], ['hor', 'Horários'], ['atd', 'Atendimentos'], ['duv', 'Dúvidas'], ['ori', 'Orientações']].concat(papel === 'admin' ? [['eq', 'Equipe']] : []);
    abrir(`<div class="dlg">${cab(m.disciplina)}<div class="tabs" role="group" aria-label="Partes da monitoria">
      ${abas.map(([k, t]) => `<button class="tab" data-sec="${k}" aria-pressed="${k === sec}">${t}</button>`).join('')}</div><div id="sec" style="margin-top:18px"></div></div>`,
      async e => { const s = e.target.closest('[data-sec]'); if (s) await detalhe(id, s.dataset.sec); });
    await ({ info: secInfo, hor: secHor, atd: secAtd, duv: secDuv, ori: secOri, eq: secEq })[sec](m, papel);
  }

  function secInfo(m, papel) {
    const s = $('#sec'), adm = papel === 'admin';
    if (papel === 'professor') {
      s.innerHTML = `<p><b>Local:</b> ${esc(m.local_atend || 'não informado')}</p><p style="margin-top:10px"><b>Conteúdo em andamento:</b><br>${esc(m.conteudo_atual || 'Ainda não informado.')}</p>
        <p style="margin-top:10px"><b>Materiais necessários:</b><br>${esc(m.materiais || 'Ainda não informado.')}</p>`; return;
    }
    s.innerHTML = `<form id="fi" novalidate>
      ${adm ? `<div class="field"><label for="i-d">Disciplina</label><input id="i-d" maxlength="80" value="${esc(m.disciplina)}" required></div>` : ''}
      <div class="field"><label for="i-l">Local do atendimento</label><input id="i-l" maxlength="120" value="${esc(m.local_atend || '')}"></div>
      <div class="field"><label for="i-c">Conteúdo em andamento</label><textarea id="i-c" rows="3" maxlength="800">${esc(m.conteudo_atual || '')}</textarea></div>
      <div class="field"><label for="i-m">Materiais necessários</label><textarea id="i-m" rows="2" maxlength="500">${esc(m.materiais || '')}</textarea></div>
      <div class="field"><label for="i-x">Sobre a monitoria</label><textarea id="i-x" rows="2" maxlength="500">${esc(m.descricao || '')}</textarea></div>
      ${adm ? `<label style="display:flex;gap:8px;align-items:center;margin-bottom:16px"><input id="i-a" type="checkbox"${m.ativo ? ' checked' : ''}> Visível para os estudantes</label>` : ''}
      <div class="barra" style="justify-content:space-between"><button class="btn" type="submit">Salvar</button>${adm ? '<button type="button" class="btn o sm" data-del>Excluir monitoria</button>' : ''}</div></form>`;
    s.onsubmit = seguro(async e => {
      e.preventDefault();
      const v = { local_atend: $('#i-l').value.trim() || null, conteudo_atual: $('#i-c').value.trim() || null, materiais: $('#i-m').value.trim() || null, descricao: $('#i-x').value.trim() || null };
      if (adm) { v.disciplina = $('#i-d').value.trim(); v.ativo = $('#i-a').checked; if (v.disciplina.length < 2) return toast('Informe a disciplina.'); }
      ok(await db.from('mon_monitorias').update(v).eq('id', m.id)); st.sujo = true; toast('Monitoria atualizada.');
    });
    s.onclick = seguro(async e => {
      if (!e.target.closest('[data-del]') || !confirm('Excluir esta monitoria com horários, atendimentos e dúvidas?')) return;
      ok(await db.from('mon_monitorias').delete().eq('id', m.id)); st.sujo = true; toast('Monitoria excluída.'); dlg().close();
    });
  }

  async function secHor(m, papel) {
    const s = $('#sec'), ed = papel !== 'professor';
    const rows = ok(await db.from('mon_horarios').select('*').eq('monitoria_id', m.id).order('dia_semana').order('inicio'));
    s.innerHTML = `${ed ? `<form id="fh" class="barra" novalidate>
        <div class="field" style="margin:0"><label for="h-d">Dia</label><select id="h-d">${DIAS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label for="h-i">Início</label><input id="h-i" type="time" required></div>
        <div class="field" style="margin:0"><label for="h-f">Fim</label><input id="h-f" type="time" required></div>
        <button class="btn" type="submit">Adicionar</button></form>` : ''}
      <div style="margin-top:18px">${rows.length ? rows.map(h => `<div class="item"><span><b>${DIAS[h.dia_semana]}</b> · ${hhmm(h.inicio)} às ${hhmm(h.fim)}</span>${ed ? `<button class="btn o sm" data-rm="${h.id}">Remover</button>` : ''}</div>`).join('') : '<p class="lead">Nenhum horário cadastrado.</p>'}</div>`;
    if (!ed) return;
    s.onsubmit = seguro(async e => {
      e.preventDefault(); const i = $('#h-i').value, f = $('#h-f').value;
      if (!i || !f || f <= i) return toast('Informe o início e o fim, com o fim depois do início.');
      ok(await db.from('mon_horarios').insert({ monitoria_id: m.id, dia_semana: Number($('#h-d').value), inicio: i, fim: f })); await secHor(m, papel);
    });
    s.onclick = seguro(async e => { const r = e.target.closest('[data-rm]'); if (r) { ok(await db.from('mon_horarios').delete().eq('id', r.dataset.rm)); await secHor(m, papel); } });
  }

  async function secAtd(m, papel) {
    const s = $('#sec'), ed = papel !== 'professor';
    const rows = ok(await db.from('mon_atendimentos').select('*').eq('monitoria_id', m.id).order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(100));
    s.innerHTML = `${ed ? `<form id="fa" novalidate>
        <div class="field" style="max-width:200px"><label for="a-d">Data do atendimento</label><input id="a-d" type="date" value="${hoje()}" required></div>
        <div class="field"><label for="a-a">Assuntos abordados</label><textarea id="a-a" rows="2" maxlength="800"></textarea></div>
        <div class="row2"><div class="field"><label for="a-e">Exercícios</label><textarea id="a-e" rows="2" maxlength="800"></textarea></div>
        <div class="field"><label for="a-t">Trabalhos</label><textarea id="a-t" rows="2" maxlength="800"></textarea></div></div>
        <button class="btn" type="submit">Registrar atendimento</button></form>` : '<p class="lead" style="margin-top:0">O que foi trabalhado em cada atendimento.</p>'}
      <div style="margin-top:18px">${rows.length ? rows.map(a => `<div class="item" style="align-items:flex-start"><span><b>${dia(a.data)}</b>
        ${a.assuntos ? `<br>Assuntos: ${esc(a.assuntos)}` : ''}${a.exercicios ? `<br>Exercícios: ${esc(a.exercicios)}` : ''}${a.trabalhos ? `<br>Trabalhos: ${esc(a.trabalhos)}` : ''}</span>
        ${ed ? `<button class="btn o sm" data-rm="${a.id}" aria-label="Remover o registro de ${dia(a.data)}">Remover</button>` : ''}</div>`).join('') : '<p class="lead">Nenhum atendimento registrado.</p>'}</div>`;
    if (!ed) return;
    s.onsubmit = seguro(async e => {
      e.preventDefault();
      const v = { assuntos: $('#a-a').value.trim() || null, exercicios: $('#a-e').value.trim() || null, trabalhos: $('#a-t').value.trim() || null };
      if (!$('#a-d').value) return toast('Escolha a data.');
      if (!v.assuntos && !v.exercicios && !v.trabalhos) return toast('Registre ao menos um assunto, exercício ou trabalho.');
      ok(await db.from('mon_atendimentos').insert({ monitoria_id: m.id, data: $('#a-d').value, ...v })); toast('Atendimento registrado.'); await secAtd(m, papel);
    });
    s.onclick = seguro(async e => { const r = e.target.closest('[data-rm]'); if (r && confirm('Remover este registro?')) { ok(await db.from('mon_atendimentos').delete().eq('id', r.dataset.rm)); await secAtd(m, papel); } });
  }

  /* ---------- dúvidas e conversa individual ---------- */
  async function secDuv(m, papel) {
    const s = $('#sec'), ed = papel !== 'professor';
    const rows = ok(await db.rpc('mon_listar_duvidas', { p_mon: m.id }));
    s.innerHTML = `<p class="lead" style="margin-top:0">${ed ? 'Cada dúvida é uma conversa individual. A presidência pode ler as conversas, para garantir um ambiente seguro.' : 'Você vê o conteúdo das dúvidas, sem a identificação de quem perguntou, para acompanhar as principais dificuldades.'}</p>
      ${rows.length ? rows.map(d => `<article class="card" style="margin-top:12px"><div class="item" style="border:0;padding:0"><b>${esc(d.protocolo)}</b>${pill(d.status)}</div>
        <p class="lead" style="margin:4px 0;font-size:.85rem">${d.aluno_nome ? esc(d.aluno_nome) + (d.aluno_turma ? ' · ' + esc(d.aluno_turma) : '') : 'Estudante (identificação oculta)'} · ${dth(d.criado_em)}</p>
        <p style="white-space:pre-wrap">${esc(d.texto)}</p>${ed ? `<div class="barra" style="margin-top:12px"><button class="btn o sm" data-abrir="${d.id}">Abrir conversa</button></div>` : ''}</article>`).join('')
        : '<p class="lead">Nenhuma dúvida ainda. Os estudantes enviam pelo site e elas aparecem aqui.</p>'}`;
    s.onclick = seguro(async e => { const a = e.target.closest('[data-abrir]'); if (a) await conversa(m, papel, rows.find(x => x.id === a.dataset.abrir)); });
  }

  async function conversa(m, papel, d) {
    if (!d) return;
    const msgs = ok(await db.rpc('mon_mensagens_duvida', { p_id: d.id }));
    const resp = papel === 'monitor' && d.status !== 'encerrada';
    abrir(`<div class="dlg">${cab(d.protocolo, 'data-voltar', 'Voltar')}
      <p class="lead" style="margin-top:0">${esc(d.aluno_nome || '')}${d.aluno_turma ? ' · ' + esc(d.aluno_turma) : ''} ${pill(d.status)}</p>
      <div class="nota" style="white-space:pre-wrap"><b>Dúvida</b><br>${esc(d.texto)}</div>
      ${msgs.map(x => `<div class="nota" style="white-space:pre-wrap"><b>${x.remetente === 'monitor' ? 'Monitor' : 'Estudante'}</b> · ${dth(x.criado_em)}<br>${esc(x.texto)}</div>`).join('')}
      ${resp ? '<div class="field" style="margin-top:14px"><label for="c-m">Responder</label><textarea id="c-m" rows="3" maxlength="2000"></textarea></div><button class="btn sm" data-enviar>Enviar resposta</button>'
        : papel === 'admin' ? '<p class="lead">Leitura para moderação. Só o monitor responde.</p>' : ''}
      <div class="barra" style="margin-top:14px"><button class="btn o sm" data-set="${d.status === 'encerrada' ? 'aberta' : 'encerrada'}">${d.status === 'encerrada' ? 'Reabrir conversa' : 'Encerrar conversa'}</button></div></div>`,
      async e => {
        if (e.target.closest('[data-voltar]')) return detalhe(m.id, 'duv');
        const novo = async () => conversa(m, papel, ok(await db.rpc('mon_listar_duvidas', { p_mon: m.id })).find(x => x.id === d.id));
        if (e.target.closest('[data-enviar]')) {
          const t = $('#c-m').value.trim(); if (!t) return toast('Escreva a resposta antes de enviar.');
          ok(await db.rpc('mon_responder', { p_id: d.id, p_texto: t })); toast('Resposta enviada.'); return novo();
        }
        const b = e.target.closest('[data-set]');
        if (b) { ok(await db.rpc('mon_status_duvida', { p_id: d.id, p_status: b.dataset.set })); return novo(); }
      });
  }

  /* ---------- orientações dos professores ---------- */
  async function secOri(m, papel) {
    const s = $('#sec'), ed = papel === 'professor' || papel === 'admin';
    const rows = ok(await db.from('mon_orientacoes').select('*').eq('monitoria_id', m.id).order('criado_em', { ascending: false }).limit(100));
    s.innerHTML = `<p class="lead" style="margin-top:0">Orientações e sugestões de material dos professores para os monitores.</p>
      ${ed ? `<form id="fo" novalidate><div class="field" style="max-width:260px"><label for="o-t">Tipo</label><select id="o-t"><option value="orientacao">Orientação</option><option value="material">Sugestão de material</option></select></div>
        <div class="field"><label for="o-x">Mensagem</label><textarea id="o-x" rows="3" maxlength="1000" required></textarea></div><button class="btn" type="submit">Publicar</button></form>` : ''}
      <div style="margin-top:18px">${rows.length ? rows.map(o => `<div class="item" style="align-items:flex-start"><span><span class="pill">${o.tipo === 'material' ? 'Material' : 'Orientação'}</span><br>${esc(o.texto)}<br><small>${esc(o.autor_nome || 'Professor')} · ${dth(o.criado_em)}</small></span>
        ${(papel === 'admin' || o.autor === ctx.user.id) ? `<button class="btn o sm" data-rm="${o.id}">Remover</button>` : ''}</div>`).join('') : '<p class="lead">Nenhuma orientação ainda.</p>'}</div>`;
    s.onsubmit = seguro(async e => {
      e.preventDefault(); const t = $('#o-x').value.trim(); if (!t) return toast('Escreva a mensagem.');
      ok(await db.from('mon_orientacoes').insert({ monitoria_id: m.id, tipo: $('#o-t').value, texto: t, autor_nome: ctx.nome })); await secOri(m, papel);
    });
    s.onclick = seguro(async e => { const r = e.target.closest('[data-rm]'); if (r && confirm('Remover esta mensagem?')) { ok(await db.from('mon_orientacoes').delete().eq('id', r.dataset.rm)); await secOri(m, papel); } });
  }

  /* ---------- equipe (só a presidência) ---------- */
  async function secEq(m) {
    const s = $('#sec');
    const [eq, ps] = await Promise.all([db.from('mon_equipe').select('*').eq('monitoria_id', m.id).order('funcao'), db.from('perfis').select('id,nome,email').eq('ativo', true).order('nome')]).then(a => a.map(ok));
    const nome = Object.fromEntries(ps.map(p => [p.id, p.nome || p.email]));
    s.innerHTML = `<p class="lead" style="margin-top:0">Quem está na equipe entra no painel e vê só esta monitoria. Dar acesso também concede o papel de monitor ou professor.</p>
      <form id="fe" class="barra" novalidate>
        <div class="field" style="flex:2;margin:0;min-width:200px"><label for="e-p">Pessoa</label><select id="e-p">${ps.map(p => `<option value="${p.id}">${esc(p.nome || p.email)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label for="e-f">Função</label><select id="e-f"><option value="monitor">Monitor</option><option value="professor">Professor</option></select></div>
        <button class="btn" type="submit"${ps.length ? '' : ' disabled'}>Dar acesso</button></form>
      ${ps.length ? '' : '<p class="lead">Nenhuma pessoa liberada. Libere o acesso na área Membros e gestão primeiro.</p>'}
      <div style="margin-top:18px">${eq.length ? eq.map(e => `<div class="item"><span><b>${esc(e.nome || nome[e.user_id] || 'Pessoa')}</b> · ${FUN[e.funcao]}</span>
        <button class="btn o sm" data-rm="${e.user_id}|${e.funcao}">Tirar da equipe</button></div>`).join('') : '<p class="lead">Ninguém na equipe ainda.</p>'}</div>`;
    s.onsubmit = seguro(async e => {
      e.preventDefault(); const sel = $('#e-p'); if (!sel.value) return;
      ok(await db.rpc('mon_dar_acesso', { p_mon: m.id, p_user: sel.value, p_funcao: $('#e-f').value, p_nome: sel.selectedOptions[0].textContent }));
      toast('Acesso concedido.'); await secEq(m);
    });
    s.onclick = seguro(async e => {
      const r = e.target.closest('[data-rm]'); if (!r || !confirm('Tirar esta pessoa da equipe desta monitoria?')) return;
      const [u, f] = r.dataset.rm.split('|');
      ok(await db.from('mon_equipe').delete().eq('monitoria_id', m.id).eq('user_id', u).eq('funcao', f)); await secEq(m);
    });
  }

  /* ---------- número no painel geral ---------- */
  mod.metrica = async () => {
    let n;
    if (ctx.papeis.has('admin')) { const r = await db.from('mon_monitorias').select('id', { count: 'exact', head: true }).eq('ativo', true); if (r.error) throw new Error(r.error.message); n = r.count ?? 0; }
    else n = ok(await db.from('mon_equipe').select('monitoria_id').eq('user_id', ctx.user.id)).length;
    return `${n} ${n === 1 ? 'monitoria' : 'monitorias'}`;
  };
})();
