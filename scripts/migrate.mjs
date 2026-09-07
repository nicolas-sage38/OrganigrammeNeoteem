// ============================================================================
//  Migration de l'organigramme vers Supabase
//
//  Prerequis : db/schema.sql execute dans le SQL Editor Supabase,
//              et scripts/.env.local renseigne (SUPABASE_SERVICE_ROLE_KEY).
//
//  Usage :
//    node scripts/migrate.mjs                 seed complet (remet a zero les tables)
//    node scripts/migrate.mjs --keep-photos   ne re-televerse pas les photos
//    node scripts/migrate.mjs --admin <mail>  cree aussi le compte back-office
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '..')
const BUCKET = 'photos'
const TABLES = ['assignments', 'sub_groups', 'groups', 'teams', 'people']

// ---------------------------------------------------------------- environnement
function loadEnv() {
    const file = path.join(ROOT, 'scripts', '.env.local')
    if (!fs.existsSync(file)) {
        throw new Error('scripts/.env.local manquant (voir scripts/.env.local.example)')
    }
    const env = {}
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
        if (!env[key]) throw new Error(`${key} absent de scripts/.env.local`)
    }
    return env
}

const env = loadEnv()
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => {
    const i = args.indexOf(name)
    return i === -1 ? null : args[i + 1]
}

const headers = extra => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
})

async function api(method, url, { body, extraHeaders } = {}) {
    const response = await fetch(url.startsWith('http') ? url : env.SUPABASE_URL + url, {
        method,
        headers: headers({ ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }),
        body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${url} -> ${response.status} ${text.slice(0, 400)}`)
    return text ? JSON.parse(text) : null
}

const select = (table, query = '') => api('GET', `/rest/v1/${table}${query}`)

const insert = (table, rows) =>
    api('POST', `/rest/v1/${table}`, {
        body: rows,
        extraHeaders: { Prefer: 'return=representation' },
    })

// ---------------------------------------------------------------- utilitaires
const stripAccents = value =>
    String(value)
        .normalize('NFD')
        .split('')
        .filter(char => {
            const code = char.charCodeAt(0)
            return code < 0x300 || code > 0x36f
        })
        .join('')

const slugify = value =>
    stripAccents(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

async function ensureBucket() {
    const buckets = await api('GET', '/storage/v1/bucket')
    if (buckets.some(bucket => bucket.id === BUCKET)) return 'deja present'
    await api('POST', '/storage/v1/bucket', { body: { id: BUCKET, name: BUCKET, public: true } })
    return 'cree'
}

// Televerse chaque fichier local une seule fois, renvoie fichier local -> cle storage
async function uploadPhotos(files) {
    const mapping = new Map()
    const used = new Set()
    let done = 0

    for (const file of files) {
        const source = path.join(ROOT, file)
        if (!fs.existsSync(source)) {
            console.warn(`  photo introuvable, ignoree : ${file}`)
            continue
        }
        const ext = path.extname(file).slice(1).toLowerCase() || 'jpg'
        let key = `${slugify(path.basename(file, path.extname(file)))}.${ext}`
        while (used.has(key)) key = `${slugify(path.basename(file, path.extname(file)))}-${used.size}.${ext}`
        used.add(key)

        await api('POST', `/storage/v1/object/${BUCKET}/${encodeURIComponent(key)}`, {
            body: fs.readFileSync(source),
            extraHeaders: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'x-upsert': 'true' },
        })
        mapping.set(file, key)
        done++
        if (done % 20 === 0) console.log(`  ${done}/${files.length} photos televersees`)
    }
    console.log(`  ${done}/${files.length} photos televersees`)
    return mapping
}

// ---------------------------------------------------------------- migration
async function main() {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'seed-data.json'), 'utf8'))

    console.log(`Projet   : ${env.SUPABASE_URL}`)
    console.log(`Bucket   : ${await ensureBucket()}`)

    // 1. Remise a zero (les cascades feraient le travail, on reste explicite)
    console.log('Purge des tables...')
    for (const table of TABLES) {
        await api('DELETE', `/rest/v1/${table}?id=not.is.null`)
    }

    // 2. Photos
    let photoKeys = new Map()
    const files = [
        ...new Set([
            ...seed.people.map(person => person.source_file).filter(Boolean),
            ...seed.teams.map(team => team.leader_source_file).filter(Boolean),
        ]),
    ]
    if (flag('--keep-photos')) {
        console.log('Photos : conservees (--keep-photos), reconstruction du mapping')
        files.forEach(file => {
            const ext = path.extname(file).slice(1).toLowerCase() || 'jpg'
            photoKeys.set(file, `${slugify(path.basename(file, path.extname(file)))}.${ext}`)
        })
    } else {
        console.log(`Televersement de ${files.length} photos...`)
        photoKeys = await uploadPhotos(files)
    }

    // 3. Personnes
    console.log('Insertion des personnes...')
    const people = await insert(
        'people',
        seed.people.map(person => ({
            full_name: person.full_name,
            photo_path: photoKeys.get(person.source_file) || null,
        })),
    )
    const peopleBySlug = new Map(people.map(person => [slugify(person.full_name), person.id]))

    // 4. Onglets
    console.log('Insertion des onglets...')
    const teams = await insert(
        'teams',
        seed.teams.map(team => ({
            slug: team.slug,
            label: team.label,
            leader_name: team.leader_name,
            leader_role: team.leader_role,
            leader_photo_path: photoKeys.get(team.leader_source_file) || null,
            position: team.position,
        })),
    )
    const teamIdBySlug = new Map(teams.map(team => [team.slug, team.id]))

    // 5. Blocs, sous-lignes, affectations
    console.log('Insertion des blocs, sous-lignes et affectations...')
    const assignmentRows = []
    let groupCount = 0
    let subGroupCount = 0

    for (const team of seed.teams) {
        const teamId = teamIdBySlug.get(team.slug)
        const groups = await insert(
            'groups',
            team.groups.map(group => ({ team_id: teamId, title: group.title, position: group.position })),
        )
        groupCount += groups.length
        const groupIdByPosition = new Map(groups.map(group => [group.position, group.id]))

        for (const group of team.groups) {
            const groupId = groupIdByPosition.get(group.position)
            const subGroups = await insert(
                'sub_groups',
                group.sub_groups.map(subGroup => ({
                    group_id: groupId,
                    label: subGroup.label,
                    position: subGroup.position,
                })),
            )
            subGroupCount += subGroups.length
            const subGroupIdByPosition = new Map(subGroups.map(subGroup => [subGroup.position, subGroup.id]))

            for (const subGroup of group.sub_groups) {
                const subGroupId = subGroupIdByPosition.get(subGroup.position)
                for (const assignment of subGroup.assignments) {
                    const personId = peopleBySlug.get(assignment.person)
                    if (!personId) throw new Error(`personne introuvable : ${assignment.person}`)
                    assignmentRows.push({
                        sub_group_id: subGroupId,
                        person_id: personId,
                        role: assignment.role,
                        is_manager: assignment.is_manager,
                        is_founder: assignment.is_founder,
                        position: assignment.position,
                    })
                }
            }
        }
    }
    const assignments = await insert('assignments', assignmentRows)

    // 6. Compte back-office (optionnel)
    const adminEmail = option('--admin')
    if (adminEmail) {
        const existing = await api('GET', `/auth/v1/admin/users?per_page=200`)
        const already = (existing.users || []).find(user => user.email === adminEmail)
        if (already) {
            console.log(`Compte admin : ${adminEmail} existe deja, inchange`)
        } else {
            const password = crypto.randomBytes(9).toString('base64url')
            await api('POST', '/auth/v1/admin/users', {
                body: { email: adminEmail, password, email_confirm: true },
            })
            console.log('')
            console.log('  Compte back-office cree')
            console.log(`  email        : ${adminEmail}`)
            console.log(`  mot de passe : ${password}`)
            console.log('  (a changer depuis Supabase > Authentication)')
            console.log('')
        }
    }

    // 7. Controle
    const counts = {}
    for (const table of ['people', 'teams', 'groups', 'sub_groups', 'assignments']) {
        const rows = await select(table, '?select=id')
        counts[table] = rows.length
    }
    console.log('')
    console.log('Termine.')
    console.log(
        `  ${counts.people} personnes / ${counts.teams} onglets / ${counts.groups} blocs / ` +
            `${counts.sub_groups} sous-lignes / ${counts.assignments} affectations`,
    )
    if (groupCount !== counts.groups || subGroupCount !== counts.sub_groups || assignments.length !== counts.assignments) {
        console.warn('  attention : ecart entre les insertions et le contenu final')
    }
}

main().catch(error => {
    console.error('')
    console.error('Echec : ' + error.message)
    process.exit(1)
})
