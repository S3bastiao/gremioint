-- =====================================================================
-- Grêmio · 06_esporte.sql  (rode DEPOIS do 01_base.sql)
-- Torneios gerais (qualquer esporte), grupos, mata-mata, resultados, juízes e sugestões.
-- Tabelas NOVAS (esp_*): as do protótipo (torneios, torneio_*, juizes_credenciais) não são tocadas.
-- O sorteio e o avanço de fases rodam no servidor: ou tudo acontece, ou nada.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.esp_juizes (
  id uuid primary key default gen_random_uuid(), nome text not null check (char_length(nome) between 2 and 80),
  codigo text unique not null, ativo boolean not null default true, criado_em timestamptz not null default now());
create table if not exists public.esp_torneios (
  id uuid primary key default gen_random_uuid(), nome text not null check (char_length(nome) between 2 and 100), esporte text,
  formato text not null check (formato in ('eliminatoria','grupos')),
  num_grupos int not null default 1 check (num_grupos between 1 and 8), classificam int not null default 2 check (classificam between 1 and 4),
  status text not null default 'em_andamento' check (status in ('em_andamento','encerrado')),
  campeao uuid, criado_em timestamptz not null default now(), criado_por uuid default auth.uid());
create table if not exists public.esp_equipes (
  id uuid primary key default gen_random_uuid(), torneio_id uuid not null references public.esp_torneios(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 60), grupo int);
create table if not exists public.esp_jogos (
  id uuid primary key default gen_random_uuid(), torneio_id uuid not null references public.esp_torneios(id) on delete cascade,
  fase text not null check (fase in ('grupos','eliminatoria')), rodada int not null default 1, ordem int not null default 1,
  equipe_a uuid references public.esp_equipes(id) on delete set null, equipe_b uuid references public.esp_equipes(id) on delete set null,
  placar_a int check (placar_a >= 0), placar_b int check (placar_b >= 0), vencedor uuid references public.esp_equipes(id) on delete set null,
  status text not null default 'agendado' check (status in ('agendado','andamento','encerrado')),
  data date, hora time, local text, juiz_id uuid references public.esp_juizes(id) on delete set null,
  prox_jogo uuid references public.esp_jogos(id) on delete set null, prox_slot text check (prox_slot in ('a','b')));
create table if not exists public.esp_eventos (
  id uuid primary key default gen_random_uuid(), jogo_id uuid not null references public.esp_jogos(id) on delete cascade,
  tipo text not null check (tipo in ('gol','amarelo','vermelho','ponto')), jogador text, equipe_id uuid references public.esp_equipes(id),
  minuto int, criado_em timestamptz not null default now());
create table if not exists public.esp_sugestoes (
  id uuid primary key default gen_random_uuid(), texto text not null, anonimo boolean not null default false,
  autor_nome text, autor_turma text, status text not null default 'pendente' check (status in ('pendente','aprovada','arquivada')),
  criado_em timestamptz not null default now());

-- ---------- regras de acesso ----------
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' and tablename like 'esp\_%'
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;
alter table public.esp_juizes    enable row level security; alter table public.esp_torneios enable row level security;
alter table public.esp_equipes   enable row level security; alter table public.esp_jogos    enable row level security;
alter table public.esp_eventos   enable row level security; alter table public.esp_sugestoes enable row level security;
-- Placar e chaveamento são públicos (site dos estudantes); códigos de juízes só a diretoria vê.
create policy t_ler on public.esp_torneios for select using (true);
create policy e_ler on public.esp_equipes  for select using (true);
create policy j_ler on public.esp_jogos    for select using (true);
create policy v_ler on public.esp_eventos  for select using (true);
create policy t_dir on public.esp_torneios for all using (public.tem_papel('dir_esporte')) with check (public.tem_papel('dir_esporte'));
create policy e_dir on public.esp_equipes  for all using (public.tem_papel('dir_esporte')) with check (public.tem_papel('dir_esporte'));
create policy j_dir on public.esp_jogos    for all using (public.tem_papel('dir_esporte')) with check (public.tem_papel('dir_esporte'));
create policy v_dir on public.esp_eventos  for all using (public.tem_papel('dir_esporte')) with check (public.tem_papel('dir_esporte'));
create policy ju_dir on public.esp_juizes  for all using (public.tem_papel('dir_esporte')) with check (public.tem_papel('dir_esporte'));
create policy s_enviar on public.esp_sugestoes for insert with check (status='pendente' and char_length(texto) between 3 and 500
  and coalesce(char_length(autor_nome),0) <= 80 and coalesce(char_length(autor_turma),0) <= 40);
create policy s_dir on public.esp_sugestoes for all using (public.tem_papel('dir_esporte')) with check (public.tem_papel('dir_esporte'));

-- ---------- classificação da fase de grupos (3 pontos vitória, 1 empate; desempate: saldo, gols pró) ----------
create or replace function public.esp_classificacao(p_id uuid)
returns table (grupo int, equipe_id uuid, nome text, j int, v int, e int, d int, gp int, gc int, sg int, pts int)
language sql stable as $$
  with t as (select q.id, q.grupo, q.nome, case when g.equipe_a=q.id then g.placar_a else g.placar_b end as pro,
                    case when g.equipe_a=q.id then g.placar_b else g.placar_a end as contra
             from public.esp_equipes q left join public.esp_jogos g on g.torneio_id=q.torneio_id and g.fase='grupos' and g.status='encerrado' and q.id in (g.equipe_a,g.equipe_b)
             where q.torneio_id=p_id)
  select grupo, id, nome, count(pro)::int, (count(*) filter (where pro>contra))::int, (count(*) filter (where pro=contra))::int,
         (count(*) filter (where pro<contra))::int, coalesce(sum(pro),0)::int, coalesce(sum(contra),0)::int, coalesce(sum(pro-contra),0)::int,
         (3*count(*) filter (where pro>contra) + count(*) filter (where pro=contra))::int
  from t group by grupo, id, nome order by 1, 11 desc, 10 desc, 8 desc, 3;
$$;

-- ---------- passa o vencedor de um jogo para o próximo ----------
create or replace function public._esp_avancar(p_jogo uuid) returns void language plpgsql as $$
declare g public.esp_jogos;
begin
  select * into g from public.esp_jogos where id = p_jogo;
  if g.prox_jogo is null then return; end if;
  if g.prox_slot = 'a' then update public.esp_jogos set equipe_a = g.vencedor where id = g.prox_jogo;
  else update public.esp_jogos set equipe_b = g.vencedor where id = g.prox_jogo; end if;
end $$;

-- ---------- monta o mata-mata (byes espalhados: nunca "bye contra bye") ----------
create or replace function public._esp_montar_chave(p_t uuid, p_eq uuid[]) returns void language plpgsql as $$
declare n int := array_length(p_eq,1); s int := 1; byes int; metade int; i int; k int; rod int := 1; v uuid; prev uuid[] := '{}'; cur uuid[];
begin
  while s < n loop s := s*2; end loop;
  byes := s - n; metade := s/2;
  for i in 1..metade loop
    v := gen_random_uuid();
    if i <= byes then
      insert into public.esp_jogos (id, torneio_id, fase, rodada, ordem, equipe_a, vencedor, status) values (v, p_t, 'eliminatoria', 1, i, p_eq[i], p_eq[i], 'encerrado');
    else
      k := i - byes;
      insert into public.esp_jogos (id, torneio_id, fase, rodada, ordem, equipe_a, equipe_b) values (v, p_t, 'eliminatoria', 1, i, p_eq[byes+2*k-1], p_eq[byes+2*k]);
    end if;
    prev := prev || v;
  end loop;
  while array_length(prev,1) > 1 loop
    rod := rod + 1; cur := '{}';
    for i in 1..array_length(prev,1)/2 loop
      v := gen_random_uuid();
      insert into public.esp_jogos (id, torneio_id, fase, rodada, ordem) values (v, p_t, 'eliminatoria', rod, i);
      update public.esp_jogos set prox_jogo = v, prox_slot = 'a' where id = prev[2*i-1];
      update public.esp_jogos set prox_jogo = v, prox_slot = 'b' where id = prev[2*i];
      cur := cur || v;
    end loop;
    prev := cur;
  end loop;
  perform public._esp_avancar(id) from public.esp_jogos where torneio_id = p_t and rodada = 1 and fase = 'eliminatoria' and vencedor is not null;
end $$;

-- ---------- cria o torneio, sorteia as equipes e já gera o chaveamento ----------
create or replace function public.esp_criar_torneio(p_nome text, p_esporte text, p_formato text, p_grupos int, p_class int, p_equipes text[]) returns uuid
language plpgsql as $$
declare t uuid; nomes text[]; ids uuid[] := '{}'; v uuid; i int; a int; b int; g int; o int := 0; ng int := case when p_formato='grupos' then greatest(p_grupos,1) else 1 end;
begin
  select array_agg(n order by random()) into nomes from (select distinct on (lower(trim(x))) trim(x) as n from unnest(p_equipes) x where trim(x) <> '') s;
  if coalesce(array_length(nomes,1),0) < 2 then raise exception 'Informe ao menos 2 equipes diferentes.'; end if;
  if p_formato = 'grupos' and array_length(nomes,1) < 2*ng then raise exception 'Cada grupo precisa de ao menos 2 equipes.'; end if;
  insert into public.esp_torneios (nome, esporte, formato, num_grupos, classificam) values (trim(p_nome), nullif(trim(p_esporte),''), p_formato, ng, greatest(least(coalesce(p_class,2),4),1)) returning id into t;
  for i in 1..array_length(nomes,1) loop
    v := gen_random_uuid(); ids := ids || v;
    insert into public.esp_equipes (id, torneio_id, nome, grupo) values (v, t, nomes[i], case when p_formato='grupos' then ((i-1) % ng) + 1 end);
  end loop;
  if p_formato = 'grupos' then
    for g in 1..ng loop
      for a in 1..array_length(ids,1) loop for b in a+1..array_length(ids,1) loop
        if ((a-1) % ng) + 1 = g and ((b-1) % ng) + 1 = g then o := o + 1;
          insert into public.esp_jogos (torneio_id, fase, rodada, ordem, equipe_a, equipe_b) values (t, 'grupos', 1, o, ids[a], ids[b]); end if;
      end loop; end loop;
    end loop;
  else perform public._esp_montar_chave(t, ids); end if;
  return t;
end $$;

-- ---------- registra o resultado de um jogo e avança o vencedor ----------
create or replace function public.esp_registrar_resultado(p_jogo uuid, p_a int, p_b int, p_vencedor uuid default null) returns void
language plpgsql as $$
declare g public.esp_jogos; w uuid; prox public.esp_jogos;
begin
  select * into g from public.esp_jogos where id = p_jogo for update;
  if not found then raise exception 'Jogo não encontrado.'; end if;
  if g.equipe_a is null or g.equipe_b is null then raise exception 'Este jogo ainda não tem as duas equipes.'; end if;
  if p_a is null or p_b is null or p_a < 0 or p_b < 0 then raise exception 'Informe os dois placares.'; end if;
  if g.prox_jogo is not null then select * into prox from public.esp_jogos where id = g.prox_jogo;
    if prox.status = 'encerrado' then raise exception 'A próxima fase deste jogo já foi jogada.'; end if; end if;
  if g.fase = 'eliminatoria' then
    w := case when p_a > p_b then g.equipe_a when p_b > p_a then g.equipe_b else p_vencedor end;
    if w is null or w not in (g.equipe_a, g.equipe_b) then raise exception 'Empate no mata-mata: escolha o vencedor (pênaltis).'; end if;
  end if;
  update public.esp_jogos set placar_a = p_a, placar_b = p_b, vencedor = w, status = 'encerrado' where id = p_jogo;
  if g.fase = 'eliminatoria' then
    if g.prox_jogo is not null then perform public._esp_avancar(p_jogo);
    else update public.esp_torneios set status = 'encerrado', campeao = w where id = g.torneio_id; end if;
  end if;
end $$;

-- ---------- fim dos grupos: gera o mata-mata com os melhores de cada grupo ----------
create or replace function public.esp_avancar_fase(p_id uuid) returns void
language plpgsql as $$
declare t public.esp_torneios; ord uuid[] := '{}'; g int; p int; x uuid;
begin
  select * into t from public.esp_torneios where id = p_id;
  if not found or t.formato <> 'grupos' then raise exception 'Este torneio não tem fase de grupos.'; end if;
  if exists (select 1 from public.esp_jogos where torneio_id = p_id and fase = 'eliminatoria') then raise exception 'O mata-mata já foi gerado.'; end if;
  if exists (select 1 from public.esp_jogos where torneio_id = p_id and fase = 'grupos' and status <> 'encerrado') then raise exception 'Termine todos os jogos dos grupos antes.'; end if;
  for g in 1..t.num_grupos loop
    select equipe_id into x from public.esp_classificacao(p_id) where grupo = g order by pts desc, sg desc, gp desc, nome offset 0 limit 1; ord := ord || x;
    if t.classificam >= 2 then select equipe_id into x from public.esp_classificacao(p_id) where grupo = (g % t.num_grupos) + 1 order by pts desc, sg desc, gp desc, nome offset 1 limit 1; ord := ord || x; end if;
  end loop;
  for p in 3..t.classificam loop for g in 1..t.num_grupos loop
    select equipe_id into x from public.esp_classificacao(p_id) where grupo = g order by pts desc, sg desc, gp desc, nome offset p-1 limit 1; if x is not null then ord := ord || x; end if;
  end loop; end loop;
  if array_length(ord,1) < 2 then raise exception 'Equipes insuficientes para o mata-mata.'; end if;
  perform public._esp_montar_chave(p_id, ord);
end $$;

-- ---------- credencial de juiz: 6 letras e números, sem 0/O/1/I ----------
create or replace function public.esp_criar_juiz(p_nome text) returns json
language plpgsql set search_path = public, extensions as $$
declare c text; i int; al text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; j public.esp_juizes;
begin
  loop
    b := gen_random_bytes(6); c := '';
    for i in 0..5 loop c := c || substr(al, (get_byte(b,i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.esp_juizes where codigo = c);
  end loop;
  insert into public.esp_juizes (nome, codigo) values (trim(p_nome), c) returning * into j;
  return row_to_json(j);
end $$;

revoke all on function public.esp_classificacao(uuid), public._esp_avancar(uuid), public._esp_montar_chave(uuid,uuid[]),
  public.esp_criar_torneio(text,text,text,int,int,text[]), public.esp_registrar_resultado(uuid,int,int,uuid), public.esp_avancar_fase(uuid), public.esp_criar_juiz(text) from public, anon;
grant execute on function public.esp_classificacao(uuid) to anon, authenticated;
grant execute on function public.esp_criar_torneio(text,text,text,int,int,text[]), public.esp_registrar_resultado(uuid,int,int,uuid), public.esp_avancar_fase(uuid), public.esp_criar_juiz(text) to authenticated;

drop trigger if exists audit_esp_t on public.esp_torneios; create trigger audit_esp_t after insert or update or delete on public.esp_torneios for each row execute function public.auditar();
drop trigger if exists audit_esp_j on public.esp_jogos;    create trigger audit_esp_j after insert or update or delete on public.esp_jogos    for each row execute function public.auditar();
drop trigger if exists audit_esp_ju on public.esp_juizes;  create trigger audit_esp_ju after insert or update or delete on public.esp_juizes for each row execute function public.auditar();
