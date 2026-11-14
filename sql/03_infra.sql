-- =====================================================================
-- Grêmio · 03_infra.sql  (rode DEPOIS do 01_base.sql)
-- Relatos de infraestrutura, anotações, achados e perdidos e fotos.
-- Aproveita as tabelas do protótipo (infra_relatos, infra_notas, achados_perdidos),
-- padroniza os status e SUBSTITUI as regras de acesso antigas por regras por papel.
-- =====================================================================

create table if not exists public.infra_relatos (
  id uuid primary key default gen_random_uuid(),
  local text not null, descricao text, foto_url text,
  prioridade text not null default 'media', status text not null default 'pendente',
  criado_em timestamptz not null default now()
);
create table if not exists public.infra_notas (
  id uuid primary key default gen_random_uuid(),
  relato_id uuid not null references public.infra_relatos(id) on delete cascade,
  nota text not null, criado_em timestamptz not null default now()
);
create table if not exists public.achados_perdidos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'achado', item_nome text not null, local text, descricao text, foto_url text,
  status_admin text not null default 'novo', reivindicado_por text,
  criado_em timestamptz not null default now()
);
alter table public.infra_notas
  add column if not exists autor uuid default auth.uid(), add column if not exists autor_nome text;

-- ---------- padroniza os valores do protótipo (Em andamento -> em_andamento etc.) ----------
update public.infra_relatos set status = case lower(status)
  when 'em andamento' then 'em_andamento' when 'concluído' then 'concluido' else lower(status) end;
update public.infra_relatos set status = 'pendente' where status not in ('pendente','em_andamento','concluido');
update public.infra_relatos set prioridade = case lower(prioridade)
  when 'baixa' then 'baixa' when 'alta' then 'alta' when 'urgente' then 'urgente' else 'media' end;
update public.achados_perdidos set status_admin = lower(status_admin);
update public.achados_perdidos set status_admin = 'disponivel' where status_admin = 'disponível';
update public.achados_perdidos set status_admin = 'novo' where status_admin not in ('novo','disponivel','reivindicado','devolvido');
update public.achados_perdidos set tipo = 'achado' where tipo not in ('achado','perdido');

alter table public.infra_relatos drop constraint if exists infra_status_ck, drop constraint if exists infra_prio_ck;
alter table public.infra_relatos
  add constraint infra_status_ck check (status in ('pendente','em_andamento','concluido')),
  add constraint infra_prio_ck   check (prioridade in ('baixa','media','alta','urgente'));
alter table public.achados_perdidos drop constraint if exists achados_status_ck, drop constraint if exists achados_tipo_ck;
alter table public.achados_perdidos
  add constraint achados_status_ck check (status_admin in ('novo','disponivel','reivindicado','devolvido')),
  add constraint achados_tipo_ck   check (tipo in ('achado','perdido'));

-- ---------- regras de acesso ----------
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('infra_relatos','infra_notas','achados_perdidos')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

alter table public.infra_relatos    enable row level security;
alter table public.infra_notas      enable row level security;
alter table public.achados_perdidos enable row level security;

-- Estudante só ENVIA relato (sempre pendente, prioridade padrão; a diretoria classifica).
create policy infra_enviar on public.infra_relatos for insert
  with check (status = 'pendente' and prioridade = 'media' and char_length(local) between 2 and 100
              and coalesce(char_length(descricao),0) <= 1000);
create policy infra_dir  on public.infra_relatos for all using (public.tem_papel('dir_infra')) with check (public.tem_papel('dir_infra'));
create policy notas_dir  on public.infra_notas   for all using (public.tem_papel('dir_infra')) with check (public.tem_papel('dir_infra'));

-- Achados e perdidos: o público vê só o que a diretoria publicou; estudante envia como 'novo'.
create policy ach_ler    on public.achados_perdidos for select using (status_admin = 'disponivel' or public.tem_papel('dir_infra'));
create policy ach_enviar on public.achados_perdidos for insert
  with check (status_admin = 'novo' and reivindicado_por is null and char_length(item_nome) between 2 and 100
              and coalesce(char_length(local),0) <= 100 and coalesce(char_length(descricao),0) <= 500);
create policy ach_dir    on public.achados_perdidos for all using (public.tem_papel('dir_infra')) with check (public.tem_papel('dir_infra'));

-- ---------- fotos (Storage): imagens de até 3 MB; envio só nas pastas infra/ e achados/ ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists fotos_enviar on storage.objects;
create policy fotos_enviar on storage.objects for insert
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] in ('infra','achados'));
drop policy if exists fotos_apagar on storage.objects;
create policy fotos_apagar on storage.objects for delete
  using (bucket_id = 'fotos' and public.tem_papel('dir_infra'));

-- ---------- auditoria ----------
drop trigger if exists audit_infra_rel on public.infra_relatos;    create trigger audit_infra_rel after insert or update or delete on public.infra_relatos    for each row execute function public.auditar();
drop trigger if exists audit_infra_not on public.infra_notas;      create trigger audit_infra_not after insert or update or delete on public.infra_notas      for each row execute function public.auditar();
drop trigger if exists audit_achados   on public.achados_perdidos; create trigger audit_achados   after insert or update or delete on public.achados_perdidos for each row execute function public.auditar();
