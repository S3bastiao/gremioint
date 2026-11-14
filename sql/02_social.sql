-- =====================================================================
-- Grêmio · 02_social.sql  (rode DEPOIS do 01_base.sql)
-- Eventos, dias, recursos, ingressos e sugestões dos estudantes.
-- Aproveita as tabelas do protótipo (eventos, eventos_datas, sugestoes_eventos)
-- se já existirem, e SUBSTITUI as regras de acesso antigas delas por regras por papel.
-- Pressupõe que eventos.id seja uuid (padrão do Supabase).
-- =====================================================================

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null, categoria text, descricao text,
  hora_inicio time, hora_fim time
);
alter table public.eventos
  add column if not exists local_evento text,
  add column if not exists publicado boolean not null default true,
  add column if not exists criado_por uuid default auth.uid(),
  add column if not exists criado_em timestamptz not null default now();

create table if not exists public.eventos_datas (
  evento_id uuid not null references public.eventos(id) on delete cascade,
  data date not null
);
create unique index if not exists eventos_datas_unico on public.eventos_datas (evento_id, data);

create table if not exists public.eventos_recursos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  nome text not null,
  quantidade int not null default 1 check (quantidade > 0),
  responsavel text,
  status text not null default 'pendente' check (status in ('pendente','providenciado')),
  criado_em timestamptz not null default now()
);

create table if not exists public.ingressos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  nome text not null,
  turma text,
  valor numeric(10,2) not null default 0 check (valor >= 0),
  pago boolean not null default false,
  retirado boolean not null default false,
  criado_em timestamptz not null default now()
);

create table if not exists public.sugestoes_eventos (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  anonimo boolean not null default false,
  autor_nome text, autor_turma text,
  status text not null default 'pendente',
  criado_em timestamptz not null default now()
);

-- ---------- regras de acesso: apaga as antigas e cria as novas ----------
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('eventos','eventos_datas','eventos_recursos','ingressos','sugestoes_eventos')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

alter table public.eventos           enable row level security;
alter table public.eventos_datas     enable row level security;
alter table public.eventos_recursos  enable row level security;
alter table public.ingressos         enable row level security;
alter table public.sugestoes_eventos enable row level security;

-- Eventos publicados são públicos (site dos estudantes); a diretoria vê e edita tudo.
create policy ev_ler   on public.eventos for select using (publicado or public.tem_papel('dir_social'));
create policy ev_dir   on public.eventos for all    using (public.tem_papel('dir_social')) with check (public.tem_papel('dir_social'));

create policy evd_ler  on public.eventos_datas for select using (exists (select 1 from public.eventos e where e.id = evento_id));
create policy evd_dir  on public.eventos_datas for all    using (public.tem_papel('dir_social')) with check (public.tem_papel('dir_social'));

-- Recursos e ingressos (dados de estudantes): só a diretoria.
create policy rec_dir  on public.eventos_recursos for all using (public.tem_papel('dir_social')) with check (public.tem_papel('dir_social'));
create policy ing_dir  on public.ingressos        for all using (public.tem_papel('dir_social')) with check (public.tem_papel('dir_social'));

-- Qualquer estudante pode ENVIAR uma sugestão (sempre como pendente); só a diretoria lê e decide.
create policy sug_enviar on public.sugestoes_eventos for insert
  with check (status = 'pendente' and char_length(texto) between 3 and 500
              and coalesce(char_length(autor_nome),0) <= 80 and coalesce(char_length(autor_turma),0) <= 40);
create policy sug_dir    on public.sugestoes_eventos for all
  using (public.tem_papel('dir_social')) with check (public.tem_papel('dir_social'));

-- ---------- salvar evento + dias em uma operação só (tudo ou nada) ----------
create or replace function public.salvar_evento(
  p_id uuid, p_titulo text, p_categoria text, p_descricao text,
  p_inicio time, p_fim time, p_local text, p_datas date[]
) returns uuid language plpgsql as $$
declare v uuid := p_id;
begin
  if coalesce(array_length(p_datas, 1), 0) = 0 then raise exception 'Escolha ao menos um dia.'; end if;
  if v is null then
    insert into public.eventos (titulo, categoria, descricao, hora_inicio, hora_fim, local_evento)
    values (p_titulo, p_categoria, p_descricao, p_inicio, p_fim, p_local) returning id into v;
  else
    update public.eventos set titulo = p_titulo, categoria = p_categoria, descricao = p_descricao,
           hora_inicio = p_inicio, hora_fim = p_fim, local_evento = p_local where id = v;
    if not found then raise exception 'Evento não encontrado ou sem permissão.'; end if;
    delete from public.eventos_datas where evento_id = v;
  end if;
  insert into public.eventos_datas (evento_id, data) select v, d from unnest(p_datas) d;
  return v;
end $$;
revoke all on function public.salvar_evento(uuid,text,text,text,time,time,text,date[]) from public, anon;
grant execute on function public.salvar_evento(uuid,text,text,text,time,time,text,date[]) to authenticated;

-- ---------- auditoria ----------
drop trigger if exists audit_eventos  on public.eventos;          create trigger audit_eventos  after insert or update or delete on public.eventos          for each row execute function public.auditar();
drop trigger if exists audit_evdatas  on public.eventos_datas;    create trigger audit_evdatas  after insert or update or delete on public.eventos_datas    for each row execute function public.auditar();
drop trigger if exists audit_evrec    on public.eventos_recursos; create trigger audit_evrec    after insert or update or delete on public.eventos_recursos for each row execute function public.auditar();
drop trigger if exists audit_ingressos on public.ingressos;       create trigger audit_ingressos after insert or update or delete on public.ingressos       for each row execute function public.auditar();
drop trigger if exists audit_sugest   on public.sugestoes_eventos; create trigger audit_sugest  after insert or update or delete on public.sugestoes_eventos for each row execute function public.auditar();
