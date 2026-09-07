-- ============================================================================
--  Organigramme Neoteem : schema Supabase complet
--  Projet : ejphfsneygykmhtysdlk
--  A executer dans le SQL Editor Supabase. Le script est idempotent :
--  il peut etre relance sans perdre de donnees.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
--  Utilitaire : mise a jour automatique de updated_at
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ----------------------------------------------------------------------------
--  people : une ligne par collaborateur (nom + photo), reutilisable
--           dans plusieurs equipes (ex : un PO present sur 2 ilots)
-- ----------------------------------------------------------------------------
create table if not exists public.people (
    id          uuid primary key default gen_random_uuid(),
    full_name   text not null,
    photo_path  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create unique index if not exists people_full_name_uniq on public.people (lower(full_name));

drop trigger if exists people_touch on public.people;
create trigger people_touch before update on public.people
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
--  teams : un onglet du trombinoscope, avec sa tete d'affiche
-- ----------------------------------------------------------------------------
create table if not exists public.teams (
    id                 uuid primary key default gen_random_uuid(),
    slug               text not null unique,
    label              text not null,
    leader_name        text,
    leader_role        text,
    leader_photo_path  text,
    position           integer not null default 0,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

drop trigger if exists teams_touch on public.teams;
create trigger teams_touch before update on public.teams
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
--  groups : un bloc blanc dans un onglet (ex : "Consultants Migration")
-- ----------------------------------------------------------------------------
create table if not exists public.groups (
    id          uuid primary key default gen_random_uuid(),
    team_id     uuid not null references public.teams (id) on delete cascade,
    title       text not null default '',
    position    integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists groups_team_idx on public.groups (team_id, position);

drop trigger if exists groups_touch on public.groups;
create trigger groups_touch before update on public.groups
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
--  sub_groups : une sous-ligne d'un bloc. label null = ligne simple,
--               affichee sans intitule (cas des blocs a une seule ligne)
-- ----------------------------------------------------------------------------
create table if not exists public.sub_groups (
    id          uuid primary key default gen_random_uuid(),
    group_id    uuid not null references public.groups (id) on delete cascade,
    label       text,
    position    integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists sub_groups_group_idx on public.sub_groups (group_id, position);

drop trigger if exists sub_groups_touch on public.sub_groups;
create trigger sub_groups_touch before update on public.sub_groups
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
--  assignments : presence d'une personne dans une sous-ligne,
--                avec son role affiche et son style de carte
-- ----------------------------------------------------------------------------
create table if not exists public.assignments (
    id            uuid primary key default gen_random_uuid(),
    sub_group_id  uuid not null references public.sub_groups (id) on delete cascade,
    person_id     uuid not null references public.people (id) on delete cascade,
    role          text not null default '',
    is_manager    boolean not null default false,
    is_founder    boolean not null default false,
    position      integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (sub_group_id, person_id)
);

create index if not exists assignments_sub_group_idx on public.assignments (sub_group_id, position);
create index if not exists assignments_person_idx on public.assignments (person_id);

drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch before update on public.assignments
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
--  Vue de confort : nombre d'affectations par personne (utilisee par l'admin
--  pour prevenir avant une suppression)
-- ----------------------------------------------------------------------------
create or replace view public.v_people_usage as
select
    p.id,
    p.full_name,
    p.photo_path,
    count(a.id)::int as assignment_count
from public.people p
left join public.assignments a on a.person_id = p.id
group by p.id, p.full_name, p.photo_path;

-- ----------------------------------------------------------------------------
--  Row Level Security : lecture publique, ecriture reservee aux comptes
--  authentifies (le back-office se connecte via Supabase Auth)
-- ----------------------------------------------------------------------------
alter table public.people      enable row level security;
alter table public.teams       enable row level security;
alter table public.groups      enable row level security;
alter table public.sub_groups  enable row level security;
alter table public.assignments enable row level security;

do $$
declare
    t text;
begin
    for t in select unnest(array['people', 'teams', 'groups', 'sub_groups', 'assignments'])
    loop
        execute format('drop policy if exists "lecture publique" on public.%I', t);
        execute format('drop policy if exists "ecriture authentifiee" on public.%I', t);
        execute format(
            'create policy "lecture publique" on public.%I for select to anon, authenticated using (true)', t);
        execute format(
            'create policy "ecriture authentifiee" on public.%I for all to authenticated using (true) with check (true)',
            t);
    end loop;
end;
$$;

-- ----------------------------------------------------------------------------
--  Droits explicites (les policies RLS ci-dessus restent le vrai garde-fou)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.people, public.teams, public.groups, public.sub_groups, public.assignments
    to anon, authenticated;

grant insert, update, delete on public.people, public.teams, public.groups, public.sub_groups, public.assignments
    to authenticated;

grant select on public.v_people_usage to anon, authenticated;

-- ----------------------------------------------------------------------------
--  Storage : bucket public "photos" (lecture pour tous, ecriture authentifiee)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "photos lecture publique" on storage.objects;
create policy "photos lecture publique" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'photos');

drop policy if exists "photos ecriture authentifiee" on storage.objects;
create policy "photos ecriture authentifiee" on storage.objects
    for all to authenticated
    using (bucket_id = 'photos')
    with check (bucket_id = 'photos');
