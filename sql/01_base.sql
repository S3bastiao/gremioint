-- =====================================================================
-- Grêmio · 01_base.sql
-- Perfis, papéis, mandatos, auditoria e regras de acesso (RLS).
-- Rode no Supabase: SQL Editor > New query > Run.
-- A segurança real mora aqui; o painel só esconde o que o usuário não pode usar.
-- =====================================================================

create type public.papel as enum (
  'admin','dir_social','dir_mulher','dir_infra','dir_tesouraria','dir_esporte','monitor','professor'
);

create table public.mandatos (
  id     uuid primary key default gen_random_uuid(),
  nome   text not null,
  inicio date not null,
  fim    date,
  atual  boolean not null default false
);
create unique index um_mandato_atual on public.mandatos (atual) where atual;

-- Um perfil por usuário do Supabase Auth. Nasce DESATIVADO: a presidência libera.
create table public.perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null default '',
  email     text,
  ativo     boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Quem tem qual papel, em qual mandato. Um usuário pode ter mais de um papel.
create table public.membros_papeis (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.perfis(id) on delete cascade,
  papel      public.papel not null,
  mandato_id uuid references public.mandatos(id),
  ativo      boolean not null default true,
  unique (user_id, papel, mandato_id)
);

-- Cria o perfil sozinho quando um usuário é criado em Authentication.
create function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome',''), new.email);
  return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
for each row execute function public.novo_usuario();

-- ---------- funções de permissão (usadas nas regras de todos os módulos) ----------
-- admin passa em qualquer verificação de papel.
create function public.tem_papel(p public.papel) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis f
    join public.membros_papeis m on m.user_id = f.id
    where f.id = auth.uid() and f.ativo and m.ativo and (m.papel = p or m.papel = 'admin')
  );
$$;

create function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.tem_papel('admin');
$$;

create function public.eh_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis f
    join public.membros_papeis m on m.user_id = f.id
    where f.id = auth.uid() and f.ativo and m.ativo
  );
$$;

-- ---------- auditoria: quem mudou o quê ----------
create table public.auditoria (
  id        bigint generated always as identity primary key,
  quando    timestamptz not null default now(),
  usuario   uuid default auth.uid(),
  tabela    text not null,
  operacao  text not null,
  registro  jsonb,
  anterior  jsonb
);

-- Gatilho reutilizável: cada módulo novo liga a auditoria com uma linha (veja o fim do arquivo).
create function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (tabela, operacao, registro, anterior)
  values (tg_table_name, tg_op,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          case when tg_op <> 'INSERT' then to_jsonb(old) end);
  return coalesce(new, old);
end $$;

create trigger audit_mandatos        after insert or update or delete on public.mandatos        for each row execute function public.auditar();
create trigger audit_perfis          after insert or update or delete on public.perfis          for each row execute function public.auditar();
create trigger audit_membros_papeis  after insert or update or delete on public.membros_papeis  for each row execute function public.auditar();

-- ---------- regras de acesso (RLS) ----------
alter table public.mandatos       enable row level security;
alter table public.perfis         enable row level security;
alter table public.membros_papeis enable row level security;
alter table public.auditoria      enable row level security;

-- Cada pessoa lê só o próprio perfil e os próprios papéis; admin lê e altera tudo.
create policy perfis_ler    on public.perfis for select using (id = auth.uid() or public.eh_admin());
create policy perfis_admin  on public.perfis for update using (public.eh_admin()) with check (public.eh_admin());

create policy papeis_ler    on public.membros_papeis for select using (user_id = auth.uid() or public.eh_admin());
create policy papeis_admin  on public.membros_papeis for all    using (public.eh_admin()) with check (public.eh_admin());

create policy mandatos_ler   on public.mandatos for select using (public.eh_membro());
create policy mandatos_admin on public.mandatos for all    using (public.eh_admin()) with check (public.eh_admin());

-- Auditoria: só o admin lê; ninguém grava direto (só o gatilho).
create policy auditoria_ler on public.auditoria for select using (public.eh_admin());

-- =====================================================================
-- PRIMEIRO ADMIN (faça uma vez)
-- 1) Authentication > Users > Add user (e-mail + senha, marque "Auto confirm").
-- 2) Troque o e-mail abaixo pelo seu e rode:
--
--   insert into public.mandatos (nome, inicio, atual) values ('Gestão 2026', '2026-01-01', true);
--   update public.perfis set ativo = true, nome = 'Seu nome' where email = 'seu@email.com';
--   insert into public.membros_papeis (user_id, papel, mandato_id)
--     select p.id, 'admin', (select id from public.mandatos where atual) from public.perfis p where p.email = 'seu@email.com';
--
-- DAR PAPEL A OUTRA PESSOA (depois de criar o usuário dela e ativar o perfil):
--   insert into public.membros_papeis (user_id, papel, mandato_id)
--     select p.id, 'dir_esporte', (select id from public.mandatos where atual) from public.perfis p where p.email = 'diretor@email.com';
--
-- LIGAR A AUDITORIA EM UMA TABELA NOVA (cada módulo fará isto):
--   create trigger audit_NOME after insert or update or delete on public.NOME
--     for each row execute function public.auditar();
-- =====================================================================
