# Organigramme Neoteem

Trombinoscope interactif, alimente par une base Supabase et administrable depuis le navigateur.

- `index.html` : le trombinoscope public (lecture seule, aucune donnee en dur, recherche par nom ou role)
- `admin.html` : le back-office (connexion requise)
- `db/schema.sql` : le schema Supabase complet (tables, RLS, bucket photos)
- `db/seed-data.json` : la structure d'origine, utilisee pour le premier chargement
- `scripts/migrate.mjs` : televerse les photos et remplit la base depuis le seed

## Modele de donnees

| Table         | Role                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `people`      | une fiche par collaborateur (nom + photo), reutilisable partout           |
| `teams`       | un onglet du trombinoscope, avec sa tete d'affiche (nom, fonction, photo) |
| `groups`      | un bloc blanc dans un onglet (ex : "Consultants Migration")               |
| `sub_groups`  | une sous-ligne du bloc (`label` null = simple rangee de cartes)           |
| `assignments` | la presence d'une personne dans une sous-ligne : role, manager, fondateur |

Une meme personne peut apparaitre sur plusieurs cartes (un PO sur deux ilots par exemple) :
sa photo et son nom sont mutualises, seul le role affiche varie.

Les photos vivent dans le bucket Storage public `photos`. Les tables ne stockent que la cle du fichier.

## Installation

### 1. Creer le schema

Coller le contenu de `db/schema.sql` dans **Supabase > SQL Editor > Run**.
Le script est idempotent, il peut etre relance sans perdre de donnees.

### 2. Configurer la cle de service

```bash
cp scripts/.env.local.example scripts/.env.local
# puis renseigner SUPABASE_SERVICE_ROLE_KEY
```

`scripts/.env.local` est dans `.gitignore` : la cle `service_role` ne doit jamais etre commitee.
Seule la cle `anon` figure dans `assets/supabase-config.js`, c'est son usage normal (les ecritures
sont bloquees par les policies RLS).

### 3. Charger les donnees

```bash
node scripts/migrate.mjs --admin prenom.nom@neoteem.fr
```

Le script televerse les photos, remplit les tables depuis `db/seed-data.json` et cree le compte
back-office (mot de passe genere, affiche une seule fois).

Options :

- `--keep-photos` : ne re-televerse pas les images (seed seul)
- `--admin <mail>` : cree le compte s'il n'existe pas

Attention : le script **purge les tables** avant de reinserer le seed. Une fois la base en service,
les modifications se font depuis `admin.html`, pas en relancant la migration.

## Back-office

`admin.html` demande une connexion (Supabase Auth, email + mot de passe), puis permet de :

- **Structure** : creer, renommer, reordonner et supprimer les onglets, les blocs et les sous-lignes ;
  definir la tete d'affiche de chaque onglet ; ajouter une personne a une sous-ligne, changer son
  role affiche, la marquer **Responsable** (anneau turquoise sur la photo) ou **Direction**
  (grande carte, anneau navy), la deplacer ou la retirer
- **Personnes** : creer une fiche, renommer, changer ou retirer la photo, supprimer (avec le nombre
  de cartes concernees en garde-fou)

Les comptes se gerent dans **Supabase > Authentication > Users**. Tout compte authentifie a les
droits d'ecriture complets.

## Developpement local

Les pages utilisent des scripts depuis un CDN et l'API Supabase : un simple serveur statique suffit.

```bash
python -m http.server 8899
# puis http://127.0.0.1:8899/index.html
```
