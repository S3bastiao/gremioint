-- =====================================================================
-- Grêmio · 07_membros.sql  (rode DEPOIS do 01_base.sql)
-- Dar papel, trocar de gestão (mandato) e impedir que o último admin seja removido.
-- Só a presidência (admin) usa estas funções; as regras do 01_base já limitam as tabelas.
-- =====================================================================

-- Dá um papel a uma pessoa na gestão atual (se já existia, só reativa).
create or replace function public.dar_papel(p_user uuid, p_papel public.papel) returns void
language plpgsql as $$
declare m uuid;
begin
  if not public.eh_admin() then raise exception 'Só a presidência pode dar papéis.'; end if;
  select id into m from public.mandatos where atual;
  if m is null then raise exception 'Crie a gestão atual antes de dar papéis.'; end if;
  insert into public.membros_papeis (user_id, papel, mandato_id) values (p_user, p_papel, m)
  on conflict (user_id, papel, mandato_id) do update set ativo = true;
end $$;

-- Encerra a gestão atual, abre a nova e desativa os papéis de todos, menos o da presidência.
-- O histórico fica guardado (nada é apagado).
create or replace function public.virar_mandato(p_nome text, p_inicio date) returns uuid
language plpgsql as $$
declare v uuid;
begin
  if not public.eh_admin() then raise exception 'Só a presidência pode trocar a gestão.'; end if;
  if char_length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Dê um nome à nova gestão.'; end if;
  update public.mandatos set atual = false, fim = coalesce(fim, current_date) where atual;
  insert into public.mandatos (nome, inicio, atual) values (trim(p_nome), coalesce(p_inicio, current_date), true) returning id into v;
  update public.membros_papeis set ativo = false where ativo and papel <> 'admin';
  return v;
end $$;

revoke all on function public.dar_papel(uuid, public.papel), public.virar_mandato(text, date) from public, anon;
grant execute on function public.dar_papel(uuid, public.papel), public.virar_mandato(text, date) to authenticated;

-- Nunca deixa o sistema sem administrador (nem por remoção de papel, nem por desativar a conta).
create or replace function public.proteger_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'membros_papeis' then
    if old.papel = 'admin' and old.ativo and (tg_op = 'DELETE' or not new.ativo or new.papel <> 'admin') then
      if not exists (select 1 from public.membros_papeis m join public.perfis f on f.id = m.user_id
                     where m.papel = 'admin' and m.ativo and f.ativo and m.id <> old.id) then
        raise exception 'Não dá para remover o último administrador.';
      end if;
    end if;
  else
    if tg_op = 'DELETE' or (old.ativo and not new.ativo) then
      if exists (select 1 from public.membros_papeis where user_id = old.id and papel = 'admin' and ativo)
         and not exists (select 1 from public.membros_papeis m join public.perfis f on f.id = m.user_id
                         where m.papel = 'admin' and m.ativo and f.ativo and f.id <> old.id) then
        raise exception 'Não dá para desativar o último administrador.';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists proteger_admin_papeis on public.membros_papeis;
create trigger proteger_admin_papeis before update or delete on public.membros_papeis for each row execute function public.proteger_ultimo_admin();
drop trigger if exists proteger_admin_perfis on public.perfis;
create trigger proteger_admin_perfis before update or delete on public.perfis for each row execute function public.proteger_ultimo_admin();
