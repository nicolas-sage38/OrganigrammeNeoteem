-- ============================================================================
--  Restreindre l ecriture a une liste d administrateurs
--
--  Etat actuel : les policies autorisent l ecriture a tout compte "authenticated".
--  Comme l inscription est ouverte sur le projet et que la cle anon est publique
--  (elle est dans la page, c est son role), n importe qui peut se creer un compte
--  et modifier l organigramme. Ce script ferme cette porte.
--
--  A executer dans le SQL Editor Supabase. Idempotent.
--  A completer par : Authentication > Sign In / Providers > Email >
--  desactiver "Allow new users to sign up".
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Liste blanche
-- ----------------------------------------------------------------------------
create table if not exists public.admins (
    user_id     uuid primary key references auth.users (id) on delete cascade,
    email       text,
    created_at  timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Un compte connecte peut lire la liste (pour savoir s il a le droit),
-- mais personne ne peut la modifier depuis le web : elle se gere en SQL.
drop policy if exists "admins lecture authentifiee" on public.admins;
create policy "admins lecture authentifiee" on public.admins
    for select to authenticated
    using (true);

grant select on public.admins to authenticated;

-- ----------------------------------------------------------------------------
--  Le test utilise par toutes les policies
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ----------------------------------------------------------------------------
--  Ecriture reservee aux administrateurs (la lecture publique reste inchangee)
-- ----------------------------------------------------------------------------
do $$
declare
    t text;
begin
    for t in select unnest(array['people', 'teams', 'groups', 'sub_groups', 'assignments'])
    loop
        execute format('drop policy if exists "ecriture authentifiee" on public.%I', t);
        execute format('drop policy if exists "ecriture admin" on public.%I', t);
        execute format(
            'create policy "ecriture admin" on public.%I for all to authenticated '
            'using (public.is_admin()) with check (public.is_admin())',
            t);
    end loop;
end;
$$;

-- ----------------------------------------------------------------------------
--  Meme regle sur le bucket photos
-- ----------------------------------------------------------------------------
drop policy if exists "photos ecriture authentifiee" on storage.objects;
drop policy if exists "photos ecriture admin" on storage.objects;
create policy "photos ecriture admin" on storage.objects
    for all to authenticated
    using (bucket_id = 'photos' and public.is_admin())
    with check (bucket_id = 'photos' and public.is_admin());

-- ----------------------------------------------------------------------------
--  Peupler la liste : a adapter
-- ----------------------------------------------------------------------------
-- organigramme@neoteem.fr est le compte partage derriere l ecran de connexion
-- a mot de passe unique de admin.html : sans lui dans cette liste, plus personne
-- ne peut administrer.
insert into public.admins (user_id, email)
select id, email from auth.users
where email in ('organigramme@neoteem.fr', 'nicolas.sage@neoteem.fr')
on conflict (user_id) do nothing;

-- Pour ajouter quelqu un plus tard, apres avoir cree son compte dans
-- Authentication > Users :
--
--   insert into public.admins (user_id, email)
--   select id, email from auth.users where email = 'prenom.nom@neoteem.fr'
--   on conflict (user_id) do nothing;
--
-- Pour retirer un acces :
--
--   delete from public.admins where email = 'prenom.nom@neoteem.fr';

-- ----------------------------------------------------------------------------
--  Controle
-- ----------------------------------------------------------------------------
select a.email, a.created_at from public.admins a order by a.email;
