-- =====================================================================
-- Grêmio · 05_mulher.sql  (rode DEPOIS do 01_base.sql)
-- Relatos de assédio e preconceito, conversa anônima, registro de acessos e IF Delas.
-- Tabelas NOVAS: as do protótipo (denuncias, denuncia_mensagens, denuncia_log_acesso)
-- não são tocadas. Quando migrar, apague-as: ficaram com regras antigas e frouxas.
-- Segurança: as tabelas de relatos não têm regra de leitura direta. Tudo passa por funções
-- que conferem o papel e gravam o acesso no servidor. A presidência (admin) NÃO lê relatos.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create or replace function public.eh_dir_mulher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis f join public.membros_papeis m on m.user_id = f.id
                 where f.id = auth.uid() and f.ativo and m.ativo and m.papel = 'dir_mulher');
$$;

create sequence if not exists public.relatos_seq;
create table if not exists public.relatos_mulher (
  id uuid primary key default gen_random_uuid(),
  protocolo text unique not null default ('M' || to_char(now(),'YY') || '-' || lpad(nextval('public.relatos_seq')::text, 5, '0')),
  chave_hash bytea not null,
  categoria text not null check (categoria in ('assedio','preconceito','outro')),
  texto text not null check (char_length(texto) between 10 and 4000),
  anonimo boolean not null,
  autor_nome text, autor_turma text, autor_contato text,
  status text not null default 'pendente' check (status in ('pendente','concluido')),
  validacao text not null default 'aguardando' check (validacao in ('aguardando','validado','invalidado')),
  nota_interna text,
  criado_em timestamptz not null default now(),
  check (not anonimo or (autor_nome is null and autor_turma is null and autor_contato is null))
);
create table if not exists public.relatos_mensagens (
  id uuid primary key default gen_random_uuid(),
  relato_id uuid not null references public.relatos_mulher(id) on delete cascade,
  remetente text not null check (remetente in ('diretoria','aluno')),
  texto text not null check (char_length(texto) between 1 and 2000),
  criado_em timestamptz not null default now()
);
create table if not exists public.relatos_acessos (
  id bigint generated always as identity primary key,
  relato_id uuid not null references public.relatos_mulher(id) on delete cascade,
  usuario uuid default auth.uid(), acao text not null, quando timestamptz not null default now()
);
create table if not exists public.ifdelas_itens (
  id uuid primary key default gen_random_uuid(),
  secao text not null check (secao in ('apoio','direitos','oportunidades','ajuda')),
  titulo text not null, texto text, contato text, link text,
  ordem int not null default 0, publicado boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.relatos_mulher   enable row level security;
alter table public.relatos_mensagens enable row level security;
alter table public.relatos_acessos  enable row level security;
alter table public.ifdelas_itens    enable row level security;
-- (sem regras nas 3 primeiras: ninguém lê direto; só as funções abaixo)
drop policy if exists ifd_ler on public.ifdelas_itens;
drop policy if exists ifd_dir on public.ifdelas_itens;
create policy ifd_ler on public.ifdelas_itens for select using (publicado or public.tem_papel('dir_mulher'));
create policy ifd_dir on public.ifdelas_itens for all using (public.tem_papel('dir_mulher')) with check (public.tem_papel('dir_mulher'));
drop trigger if exists audit_ifdelas on public.ifdelas_itens;
create trigger audit_ifdelas after insert or update or delete on public.ifdelas_itens for each row execute function public.auditar();
-- Sem auditoria nas tabelas de relatos de propósito: ela copiaria o texto para uma tabela que o admin lê.

-- ---------- lado do estudante (site público; sem login) ----------
create or replace function public.enviar_relato(p_categoria text, p_texto text, p_anonimo boolean,
  p_nome text default null, p_turma text default null, p_contato text default null) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_chave text := encode(gen_random_bytes(8), 'hex'); v_prot text;
begin
  insert into public.relatos_mulher (chave_hash, categoria, texto, anonimo, autor_nome, autor_turma, autor_contato)
  values (digest(v_chave, 'sha256'), p_categoria, trim(p_texto), coalesce(p_anonimo, true),
          case when p_anonimo then null else left(trim(p_nome), 80) end,
          case when p_anonimo then null else left(trim(p_turma), 40) end,
          case when p_anonimo then null else left(trim(p_contato), 120) end)
  returning protocolo into v_prot;
  return json_build_object('protocolo', v_prot, 'chave', v_chave); -- a chave só aparece agora
end $$;

create or replace function public._relato_do_aluno(p_prot text, p_chave text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select id into v from public.relatos_mulher
   where protocolo = upper(trim(p_prot)) and chave_hash = digest(trim(p_chave), 'sha256');
  if v is null then raise exception 'Protocolo ou chave incorretos.'; end if;
  return v;
end $$;

create or replace function public.ler_conversa_aluno(p_prot text, p_chave text) returns json
language plpgsql security definer set search_path = public as $$
declare v uuid := public._relato_do_aluno(p_prot, p_chave); r public.relatos_mulher;
begin
  select * into r from public.relatos_mulher where id = v;
  return json_build_object('status', r.status, 'validacao', r.validacao,
    'mensagens', case when r.validacao = 'validado' then coalesce((select json_agg(json_build_object('remetente', remetente, 'texto', texto, 'criado_em', criado_em) order by criado_em)
                       from public.relatos_mensagens where relato_id = v), '[]'::json) else '[]'::json end);
end $$;

create or replace function public.mensagem_aluno(p_prot text, p_chave text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public._relato_do_aluno(p_prot, p_chave);
begin
  if not exists (select 1 from public.relatos_mulher where id = v and validacao = 'validado' and status = 'pendente') then
    raise exception 'A conversa ainda não está aberta.'; end if;
  insert into public.relatos_mensagens (relato_id, remetente, texto) values (v, 'aluno', trim(p_texto));
end $$;

-- ---------- lado da diretoria (cada função confere o papel e grava o acesso) ----------
create or replace function public._so_dir_mulher() returns void language plpgsql stable as $$
begin if not public.eh_dir_mulher() then raise exception 'Acesso restrito à Diretoria da Mulher.'; end if; end $$;

create or replace function public.listar_relatos(p_status text default null, p_validacao text default null)
returns table (id uuid, protocolo text, categoria text, status text, validacao text, anonimo boolean, criado_em timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._so_dir_mulher();
  return query select r.id, r.protocolo, r.categoria, r.status, r.validacao, r.anonimo, r.criado_em from public.relatos_mulher r
   where (p_status is null or r.status = p_status) and (p_validacao is null or r.validacao = p_validacao) order by r.criado_em desc limit 300;
end $$;

create or replace function public.abrir_relato(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r public.relatos_mulher;
begin
  perform public._so_dir_mulher();
  select * into r from public.relatos_mulher where id = p_id;
  if not found then raise exception 'Relato não encontrado.'; end if;
  insert into public.relatos_acessos (relato_id, acao) values (p_id, 'abriu');
  return json_build_object('id', r.id, 'protocolo', r.protocolo, 'categoria', r.categoria, 'texto', r.texto, 'anonimo', r.anonimo,
    'autor_nome', r.autor_nome, 'autor_turma', r.autor_turma, 'autor_contato', r.autor_contato,
    'status', r.status, 'validacao', r.validacao, 'nota_interna', r.nota_interna, 'criado_em', r.criado_em);
end $$;

create or replace function public.decidir_relato(p_id uuid, p_validacao text, p_status text, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._so_dir_mulher();
  update public.relatos_mulher set validacao = coalesce(p_validacao, validacao), status = coalesce(p_status, status),
         nota_interna = coalesce(p_nota, nota_interna) where id = p_id;
  if not found then raise exception 'Relato não encontrado.'; end if;
  insert into public.relatos_acessos (relato_id, acao) values (p_id, 'decidiu');
end $$;

create or replace function public.mensagens_relato(p_id uuid) returns table (remetente text, texto text, criado_em timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._so_dir_mulher();
  return query select m.remetente, m.texto, m.criado_em from public.relatos_mensagens m where m.relato_id = p_id order by m.criado_em;
end $$;

create or replace function public.responder_relato(p_id uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._so_dir_mulher();
  if not exists (select 1 from public.relatos_mulher where id = p_id and validacao = 'validado' and status = 'pendente') then
    raise exception 'A conversa só abre em relato validado e pendente.'; end if;
  insert into public.relatos_mensagens (relato_id, remetente, texto) values (p_id, 'diretoria', trim(p_texto));
  insert into public.relatos_acessos (relato_id, acao) values (p_id, 'respondeu');
end $$;

create or replace function public.acessos_relato(p_id uuid) returns table (nome text, acao text, quando timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._so_dir_mulher();
  return query select coalesce(nullif(f.nome,''), f.email), a.acao, a.quando from public.relatos_acessos a
    left join public.perfis f on f.id = a.usuario where a.relato_id = p_id order by a.quando desc limit 50;
end $$;

-- permissões de execução
revoke all on function public.enviar_relato(text,text,boolean,text,text,text), public._relato_do_aluno(text,text), public.ler_conversa_aluno(text,text),
  public.mensagem_aluno(text,text,text), public._so_dir_mulher(), public.listar_relatos(text,text), public.abrir_relato(uuid),
  public.decidir_relato(uuid,text,text,text), public.mensagens_relato(uuid), public.responder_relato(uuid,text), public.acessos_relato(uuid) from public, anon, authenticated;
grant execute on function public.enviar_relato(text,text,boolean,text,text,text), public.ler_conversa_aluno(text,text), public.mensagem_aluno(text,text,text) to anon, authenticated;
grant execute on function public.listar_relatos(text,text), public.abrir_relato(uuid), public.decidir_relato(uuid,text,text,text),
  public.mensagens_relato(uuid), public.responder_relato(uuid,text), public.acessos_relato(uuid) to authenticated;
