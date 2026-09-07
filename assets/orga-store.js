// Couche d'acces aux donnees de l'organigramme (partagee index.html / admin.html).
// Necessite supabase-js et assets/supabase-config.js charges avant ce fichier.
(function () {
  const { createClient } = window.supabase;
  const client = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  const bucket = window.SUPABASE_PHOTO_BUCKET;

  // Avatar generique pour les collaborateurs sans photo
  const AVATAR_PLACEHOLDER =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#dfe6e9"/><circle cx="50" cy="38" r="18" fill="#b2bec3"/><ellipse cx="50" cy="88" rx="32" ry="24" fill="#b2bec3"/></svg>',
    );

  function photoUrl(path) {
    if (!path) return AVATAR_PLACEHOLDER;
    if (/^(https?:|data:)/.test(path)) return path;
    return `${window.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  }

  const bySortOrder = (a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id));

  // Charge tout l'organigramme en une requete, trie par position a tous les niveaux
  async function loadTree() {
    const { data, error } = await client.from("teams").select(`
        id, slug, label, position, leader_name, leader_role, leader_photo_path,
        groups (
          id, title, position,
          sub_groups (
            id, label, position,
            assignments (
              id, role, is_manager, is_founder, position,
              person:people ( id, full_name, photo_path )
            )
          )
        )
      `);

    if (error) throw error;

    const teams = (data || []).sort(bySortOrder);
    teams.forEach(team => {
      team.groups = (team.groups || []).sort(bySortOrder);
      team.groups.forEach(group => {
        group.sub_groups = (group.sub_groups || []).sort(bySortOrder);
        group.sub_groups.forEach(subGroup => {
          subGroup.assignments = (subGroup.assignments || []).sort(bySortOrder);
        });
      });
    });
    return teams;
  }

  // Un bloc sans sous-ligne nommee s'affiche comme une simple rangee de cartes
  function isFlatGroup(group) {
    return group.sub_groups.length === 1 && !group.sub_groups[0].label;
  }

  window.Orga = { client, bucket, AVATAR_PLACEHOLDER, photoUrl, loadTree, isFlatGroup, bySortOrder };
})();
