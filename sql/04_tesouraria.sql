-- =====================================================================
-- Grêmio · 04_tesouraria.sql  (rode DEPOIS do 01_base.sql)
-- Lançamentos, ideias de arrecadação e resumo por ano calculado no servidor.
-- Aproveita financeiro_registros e ideias_arrecadacao do protótipo e
-- SUBSTITUI as regras de acesso antigas delas. Tudo aqui é restrito à tesouraria.
-- =====================================================================
create table if not exists public.financeiro_registros (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date, tipo text not null, oque text not null,
  valor numeric(12,2) not null, criado_em timestamptz not null default now()
);
create table if not exists public.ideias_arrecadacao (
  id uuid primary key default gen_random_uuid(),
  texto text not null, status text not null default 'proposta', criado_em timestamptz not null default now()
);
alter table public.financeiro_registros
  add column if not exists observacao text, add column if not exists criado_por uuid default auth.uid();

-- valores em reais com 2 casas (sem erro de arredondamento) e status padronizados
alter table public.financeiro_registros alter column valor type numeric(12,2) using round(valor::numeric, 2);
update public.financeiro_registros set tipo = case when lower(tipo) like 'gan%' then 'ganho' else 'gasto' end;
update public.financeiro_registros set valor = abs(valor) where valor < 0;
delete from public.financeiro_registros where valor = 0;
update public.ideias_arrecadacao set status = case
  when lower(status) like '%andamento%' or lower(status) like '%aprov%' then 'em_andamento'
  when lower(status) like '%conclu%' or lower(status) like '%feit%' then 'concluida'
  when lower(status) like '%descart%' or lower(status) like '%recus%' or lower(status) like '%arquiv%' then 'descartada'
  else 'proposta' end;
alter table public.financeiro_registros drop constraint if exists fin_tipo_ck, drop constraint if exists fin_valor_ck;
alter table public.financeiro_registros
  add constraint fin_tipo_ck  check (tipo in ('ganho','gasto')),
  add constraint fin_valor_ck check (valor > 0);
alter table public.ideias_arrecadacao drop constraint if exists ideia_status_ck;
alter table public.ideias_arrecadacao add constraint ideia_status_ck check (status in ('proposta','em_andamento','concluida','descartada'));
create index if not exists fin_data_idx on public.financeiro_registros (data);

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('financeiro_registros','ideias_arrecadacao')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;
alter table public.financeiro_registros enable row level security;
alter table public.ideias_arrecadacao   enable row level security;
create policy fin_dir   on public.financeiro_registros for all using (public.tem_papel('dir_tesouraria')) with check (public.tem_papel('dir_tesouraria'));
create policy ideia_dir on public.ideias_arrecadacao   for all using (public.tem_papel('dir_tesouraria')) with check (public.tem_papel('dir_tesouraria'));

-- Resumo do ano: saldo geral, ganhos, gastos e resultado de cada mês (soma no servidor, sem limite de linhas).
create or replace function public.resumo_tesouraria(p_ano int) returns json
language sql stable as $$
  select json_build_object(
    'saldo',  coalesce((select sum(case when tipo='ganho' then valor else -valor end) from public.financeiro_registros), 0),
    'ganhos', coalesce((select sum(valor) from public.financeiro_registros where tipo='ganho' and extract(year from data)=p_ano), 0),
    'gastos', coalesce((select sum(valor) from public.financeiro_registros where tipo='gasto' and extract(year from data)=p_ano), 0),
    'meses',  (select json_agg(coalesce(s.v,0) order by m.n) from generate_series(1,12) m(n)
               left join (select extract(month from data)::int mes, sum(case when tipo='ganho' then valor else -valor end) v
                          from public.financeiro_registros where extract(year from data)=p_ano group by 1) s on s.mes=m.n));
$$;
revoke all on function public.resumo_tesouraria(int) from public, anon;
grant execute on function public.resumo_tesouraria(int) to authenticated;

drop trigger if exists audit_fin   on public.financeiro_registros; create trigger audit_fin   after insert or update or delete on public.financeiro_registros for each row execute function public.auditar();
drop trigger if exists audit_ideia on public.ideias_arrecadacao;   create trigger audit_ideia after insert or update or delete on public.ideias_arrecadacao   for each row execute function public.auditar();
