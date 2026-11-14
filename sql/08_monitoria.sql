-- =====================================================================
-- Grêmio · 08_monitoria.sql  (rode DEPOIS do 01_base.sql e do 07_membros.sql)
-- Conecta Monitoria: monitorias, equipe (monitores e professores), horários,
-- atendimentos, orientações dos professores e dúvidas com conversa individual.
-- Tabelas NOVAS (mon_*). Dúvidas e mensagens não têm leitura direta: só pelas funções,
-- que conferem o papel. Professor vê as dúvidas SEM a identificação do estudante.
-- A presidência (admin) lê as conversas para moderação, pois envolvem menores de idade.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;
create sequence if not exists public.mon_seq;

create table if not exists public.mon_monitorias (
  id uuid primary key default gen_random_uuid(),
  disciplina text not null check (char_length(disciplina) between 2 and 80),
  descricao text, local_atend text, conteudo_atual text, materiais text,
  ativo boolean not null default true, criado_em timestamptz not null default now());
create table if not exists public.mon_horarios (
  id uuid primary key default gen_random_uuid(),
  monitoria_id uuid not null references public.mon_monitorias(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6), inicio time not null, fim time not null check (fim > inicio));
create table if not exists public.mon_equipe (
  monitoria_id uuid not null references public.mon_monitorias(id) on delete cascade,
  user_id uuid not null references public.perfis(id) on delete cascade,
  funcao text not null check (funcao in ('monitor','professor')), nome text,
  primary key (monitoria_id, user_id, funcao));
create table if not exists public.mon_atendimentos (
  id uuid primary key default gen_random_uuid(),
  monitoria_id uuid not null references public.mon_monitorias(id) on delete cascade,
  data date not null default current_date, assuntos text, exercicios text, trabalhos text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now());
create table if not exists public.mon_orientacoes (
  id uuid primary key default gen_random_uuid(),
  monitoria_id uuid not null references public.mon_monitorias(id) on delete cascade,
  tipo text not null default 'orientacao' check (tipo in ('orientacao','material')),
  texto text not null check (char_length(texto) between 1 and 1000),
  autor uuid default auth.uid(), autor_nome text, criado_em timestamptz not null default now());
create table if not exists public.mon_duvidas (
  id uuid primary key default gen_random_uuid(),
  monitoria_id uuid not null references public.mon_monitorias(id) on delete cascade,
  protocolo text unique not null default ('D' || to_char(now(),'YY') || '-' || lpad(nextval('public.mon_seq')::text, 5, '0')),
  chave_hash bytea not null,
  aluno_nome text not null, aluno_turma text,
  texto text not null check (char_length(texto) between 5 and 2000),
  status text not null default 'aberta' check (status in ('aberta','respondida','encerrada')),
  criado_em timestamptz not null default now());
create table if not exists public.mon_mensagens (
  id uuid primary key default gen_random_uuid(),
  duvida_id uuid not null references public.mon_duvidas(id) on delete cascade,
  remetente text not null check (remetente in ('aluno','monitor')),
  texto text not null check (char_length(texto) between 1 and 2000), criado_em timestamptz not null default now());

-- O monitor edita local, conteúdo e materiais; disciplina e visibilidade são só da presidência.
create or replace function public.mon_proteger_campos() returns trigger language plpgsql as $$
begin
  if not public.eh_admin() and (new.id is distinct from old.id or new.disciplina is distinct from old.disciplina or new.ativo is distinct from old.ativo) then
    raise exception 'Só a presidência altera a disciplina e a visibilidade da monitoria.'; end if;
  return new;
end $$;
drop trigger if exists mon_proteger on public.mon_monitorias;
create trigger mon_proteger before update on public.mon_monitorias for each row execute function public.mon_proteger_campos();

-- Está na equipe desta monitoria? (funcao opcional: 'monitor' ou 'professor')
create or replace function public.mon_na_equipe(p_mon uuid, p_funcao text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_membro() and exists (select 1 from public.mon_equipe e
    where e.monitoria_id = p_mon and e.user_id = auth.uid() and (p_funcao is null or e.funcao = p_funcao));
$$;

-- ---------- regras de acesso ----------
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' and tablename like 'mon\_%'
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;
alter table public.mon_monitorias   enable row level security; alter table public.mon_horarios   enable row level security;
alter table public.mon_equipe       enable row level security; alter table public.mon_atendimentos enable row level security;
alter table public.mon_orientacoes  enable row level security; alter table public.mon_duvidas     enable row level security;
alter table public.mon_mensagens    enable row level security;  -- duvidas e mensagens: sem regras (só funções)

-- Monitorias ativas, horários e nomes dos monitores são públicos (site dos estudantes).
create policy mon_ler  on public.mon_monitorias for select using (ativo or public.eh_admin() or public.mon_na_equipe(id));
create policy mon_ins  on public.mon_monitorias for insert with check (public.eh_admin());
create policy mon_del  on public.mon_monitorias for delete using (public.eh_admin());
create policy mon_upd  on public.mon_monitorias for update using (public.eh_admin() or public.mon_na_equipe(id,'monitor'))
                                                         with check (public.eh_admin() or public.mon_na_equipe(id,'monitor'));
create policy hor_ler  on public.mon_horarios for select using (exists (select 1 from public.mon_monitorias m where m.id = monitoria_id));
create policy hor_esc  on public.mon_horarios for all using (public.eh_admin() or public.mon_na_equipe(monitoria_id,'monitor'))
                                                    with check (public.eh_admin() or public.mon_na_equipe(monitoria_id,'monitor'));
create policy eq_ler   on public.mon_equipe for select using ((funcao = 'monitor' and exists (select 1 from public.mon_monitorias m where m.id = monitoria_id))
                                                              or user_id = auth.uid() or public.eh_admin() or public.mon_na_equipe(monitoria_id));
create policy eq_adm   on public.mon_equipe for all using (public.eh_admin()) with check (public.eh_admin());
create policy atd_ler  on public.mon_atendimentos for select using (public.eh_admin() or public.mon_na_equipe(monitoria_id));
create policy atd_esc  on public.mon_atendimentos for all using (public.eh_admin() or public.mon_na_equipe(monitoria_id,'monitor'))
                                                       with check (public.eh_admin() or public.mon_na_equipe(monitoria_id,'monitor'));
create policy ori_ler  on public.mon_orientacoes for select using (public.eh_admin() or public.mon_na_equipe(monitoria_id));
create policy ori_ins  on public.mon_orientacoes for insert with check (public.eh_admin() or public.mon_na_equipe(monitoria_id,'professor'));
create policy ori_del  on public.mon_orientacoes for delete using (public.eh_admin() or autor = auth.uid());

-- ---------- lado do estudante (site público; sem login; protocolo + chave) ----------
create or replace function public.mon_enviar_duvida(p_mon uuid, p_nome text, p_turma text, p_texto text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_chave text := encode(gen_random_bytes(8), 'hex'); v_prot text;
begin
  if not exists (select 1 from public.mon_monitorias where id = p_mon and ativo) then raise exception 'Monitoria não encontrada.'; end if;
  if char_length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe seu nome.'; end if;
  if (select count(*) from public.mon_duvidas where monitoria_id = p_mon and criado_em > now() - interval '10 minutes') >= 20 then
    raise exception 'Muitas dúvidas em pouco tempo. Tente de novo em alguns minutos.'; end if;
  insert into public.mon_duvidas (monitoria_id, chave_hash, aluno_nome, aluno_turma, texto)
  values (p_mon, digest(v_chave,'sha256'), left(trim(p_nome),80), left(trim(coalesce(p_turma,'')),40), trim(p_texto)) returning protocolo into v_prot;
  return json_build_object('protocolo', v_prot, 'chave', v_chave);   -- a chave só aparece agora
end $$;

create or replace function public._mon_duvida_do_aluno(p_prot text, p_chave text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select id into v from public.mon_duvidas where protocolo = upper(trim(p_prot)) and chave_hash = digest(trim(p_chave),'sha256');
  if v is null then raise exception 'Protocolo ou chave incorretos.'; end if;
  return v;
end $$;

create or replace function public.mon_ler_conversa(p_prot text, p_chave text) returns json
language plpgsql security definer set search_path = public as $$
declare v uuid := public._mon_duvida_do_aluno(p_prot, p_chave); d public.mon_duvidas;
begin
  select * into d from public.mon_duvidas where id = v;
  return json_build_object('disciplina', (select disciplina from public.mon_monitorias where id = d.monitoria_id),
    'texto', d.texto, 'status', d.status,
    'mensagens', coalesce((select json_agg(json_build_object('remetente', m.remetente, 'texto', m.texto, 'criado_em', m.criado_em) order by m.criado_em)
                           from public.mon_mensagens m where m.duvida_id = v), '[]'::json));
end $$;

create or replace function public.mon_mensagem_aluno(p_prot text, p_chave text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public._mon_duvida_do_aluno(p_prot, p_chave);
begin
  if exists (select 1 from public.mon_duvidas where id = v and status = 'encerrada') then raise exception 'Esta conversa foi encerrada.'; end if;
  if (select count(*) from public.mon_mensagens where duvida_id = v and remetente = 'aluno' and criado_em > now() - interval '10 minutes') >= 10 then
    raise exception 'Muitas mensagens em pouco tempo. Aguarde alguns minutos.'; end if;
  insert into public.mon_mensagens (duvida_id, remetente, texto) values (v, 'aluno', trim(p_texto));
  update public.mon_duvidas set status = 'aberta' where id = v;
end $$;

-- ---------- lado da equipe (cada função confere o papel) ----------
-- Monitor e presidência veem o nome do estudante; professor vê só o conteúdo da dúvida.
create or replace function public.mon_listar_duvidas(p_mon uuid)
returns table (id uuid, protocolo text, aluno_nome text, aluno_turma text, texto text, status text, criado_em timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_full boolean;
begin
  if not (public.eh_admin() or public.mon_na_equipe(p_mon)) then raise exception 'Acesso restrito à equipe desta monitoria.'; end if;
  v_full := public.eh_admin() or public.mon_na_equipe(p_mon, 'monitor');
  return query select d.id, d.protocolo, case when v_full then d.aluno_nome end, case when v_full then d.aluno_turma end, d.texto, d.status, d.criado_em
    from public.mon_duvidas d where d.monitoria_id = p_mon order by d.criado_em desc limit 200;
end $$;

create or replace function public.mon_mensagens_duvida(p_id uuid) returns table (remetente text, texto text, criado_em timestamptz)
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  select d.monitoria_id into m from public.mon_duvidas d where d.id = p_id;
  if m is null then raise exception 'Dúvida não encontrada.'; end if;
  if not (public.eh_admin() or public.mon_na_equipe(m,'monitor')) then raise exception 'Acesso restrito ao monitor e à presidência.'; end if;
  return query select x.remetente, x.texto, x.criado_em from public.mon_mensagens x where x.duvida_id = p_id order by x.criado_em;
end $$;

create or replace function public.mon_responder(p_id uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid; s text;
begin
  select d.monitoria_id, d.status into m, s from public.mon_duvidas d where d.id = p_id;
  if m is null then raise exception 'Dúvida não encontrada.'; end if;
  if not public.mon_na_equipe(m,'monitor') then raise exception 'Só o monitor desta monitoria responde.'; end if;
  if s = 'encerrada' then raise exception 'Esta conversa foi encerrada.'; end if;
  insert into public.mon_mensagens (duvida_id, remetente, texto) values (p_id, 'monitor', trim(p_texto));
  update public.mon_duvidas set status = 'respondida' where id = p_id;
end $$;

create or replace function public.mon_status_duvida(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if p_status not in ('aberta','respondida','encerrada') then raise exception 'Status inválido.'; end if;
  select d.monitoria_id into m from public.mon_duvidas d where d.id = p_id;
  if m is null then raise exception 'Dúvida não encontrada.'; end if;
  if not (public.eh_admin() or public.mon_na_equipe(m,'monitor')) then raise exception 'Acesso restrito ao monitor e à presidência.'; end if;
  update public.mon_duvidas set status = p_status where id = p_id;
end $$;

-- Presidência: coloca alguém na equipe e já dá o papel de acesso ao painel (usa dar_papel do 07).
create or replace function public.mon_dar_acesso(p_mon uuid, p_user uuid, p_funcao text, p_nome text) returns void
language plpgsql as $$
begin
  if not public.eh_admin() then raise exception 'Só a presidência pode dar acesso.'; end if;
  if p_funcao not in ('monitor','professor') then raise exception 'Função inválida.'; end if;
  perform public.dar_papel(p_user, p_funcao::public.papel);
  insert into public.mon_equipe (monitoria_id, user_id, funcao, nome) values (p_mon, p_user, p_funcao, nullif(trim(p_nome),''))
  on conflict (monitoria_id, user_id, funcao) do update set nome = excluded.nome;
end $$;

revoke all on function public.mon_enviar_duvida(uuid,text,text,text), public._mon_duvida_do_aluno(text,text), public.mon_ler_conversa(text,text), public.mon_mensagem_aluno(text,text,text),
  public.mon_listar_duvidas(uuid), public.mon_mensagens_duvida(uuid), public.mon_responder(uuid,text), public.mon_status_duvida(uuid,text), public.mon_dar_acesso(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.mon_enviar_duvida(uuid,text,text,text), public.mon_ler_conversa(text,text), public.mon_mensagem_aluno(text,text,text) to anon, authenticated;
grant execute on function public.mon_listar_duvidas(uuid), public.mon_mensagens_duvida(uuid), public.mon_responder(uuid,text), public.mon_status_duvida(uuid,text), public.mon_dar_acesso(uuid,uuid,text,text) to authenticated;

-- ---------- auditoria (dúvidas e mensagens ficam de fora de propósito) ----------
drop trigger if exists audit_mon_m on public.mon_monitorias;   create trigger audit_mon_m after insert or update or delete on public.mon_monitorias   for each row execute function public.auditar();
drop trigger if exists audit_mon_h on public.mon_horarios;     create trigger audit_mon_h after insert or update or delete on public.mon_horarios     for each row execute function public.auditar();
drop trigger if exists audit_mon_e on public.mon_equipe;       create trigger audit_mon_e after insert or update or delete on public.mon_equipe       for each row execute function public.auditar();
drop trigger if exists audit_mon_a on public.mon_atendimentos; create trigger audit_mon_a after insert or update or delete on public.mon_atendimentos for each row execute function public.auditar();
drop trigger if exists audit_mon_o on public.mon_orientacoes;  create trigger audit_mon_o after insert or update or delete on public.mon_orientacoes  for each row execute function public.auditar();
