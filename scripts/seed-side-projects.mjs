// One-off migration: push the bundled side projects seed (src/data/sideProjects.json) into
// the Squeak Strapi side-projects collection, skipping any entry whose title already exists.
// Once every seed entry exists, a completion marker entry is created – the gallery keeps the
// bundled seed visible until it sees the marker, so a partial run never hides projects, and
// after the marker moderator deletes/renames stick. Rerunning the script is safe.
//
// Usage:
//   SQUEAK_JWT=<moderator jwt> node scripts/seed-side-projects.mjs
//
// The JWT is a signed-in moderator's token (the `jwt` key in localStorage on posthog.com).
// SQUEAK_API_HOST overrides the target host if needed.

import { readFile } from 'node:fs/promises'

const API_HOST = process.env.SQUEAK_API_HOST || 'https://better-animal-d658c56969.strapiapp.com'
const JWT = process.env.SQUEAK_JWT

// Must match SEED_MIGRATION_MARKER in src/components/SideProjects/index.tsx
const SEED_MIGRATION_MARKER = '__seed-migration-complete__'

if (!JWT) {
    console.error('Set SQUEAK_JWT to a signed-in moderator JWT before running.')
    process.exit(1)
}

const seed = JSON.parse(await readFile(new URL('../src/data/sideProjects.json', import.meta.url), 'utf8'))

const existingTitles = new Set()
let page = 1
let pageCount = 1
while (page <= pageCount) {
    const response = await fetch(
        `${API_HOST}/api/side-projects?pagination%5Bpage%5D=${page}&pagination%5BpageSize%5D=100&fields%5B0%5D=title`
    )
    if (!response.ok) {
        console.error(`Failed to list existing projects: ${response.status} ${response.statusText}`)
        process.exit(1)
    }
    const { data, meta } = await response.json()
    for (const entry of data || []) {
        existingTitles.add(entry.attributes.title.trim().toLowerCase())
    }
    pageCount = meta?.pagination?.pageCount || 1
    page += 1
}

const createProject = async (data) => {
    const response = await fetch(`${API_HOST}/api/side-projects`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${JWT}`,
        },
        body: JSON.stringify({ data }),
    })
    if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`)
    }
}

let created = 0
let skipped = 0
const failures = []
for (const project of seed) {
    if (existingTitles.has(project.title.trim().toLowerCase())) {
        skipped += 1
        continue
    }
    const { tags = [], ...fields } = project
    try {
        await createProject({ ...fields, tags })
        created += 1
        console.log(`Created "${project.title}"`)
    } catch (error) {
        // Keep going: the marker below is only written after a fully clean run, so the
        // gallery keeps showing the bundled seed until a rerun succeeds end to end
        failures.push(project.title)
        console.error(`Failed to create "${project.title}": ${error.message}`)
    }
}

if (failures.length > 0) {
    console.error(`Done with errors: ${created} created, ${skipped} already existed, ${failures.length} FAILED.`)
    console.error('Migration is NOT marked complete – fix the failures and rerun.')
    process.exit(1)
}

if (!existingTitles.has(SEED_MIGRATION_MARKER)) {
    try {
        await createProject({
            title: SEED_MIGRATION_MARKER,
            description: 'Internal marker: the bundled seed has been fully migrated. Do not delete.',
            projectAuthor: 'PostHog',
        })
        console.log('Migration marker created.')
    } catch (error) {
        console.error(`All entries migrated, but creating the completion marker failed: ${error.message}`)
        console.error('Rerun the script to retry the marker.')
        process.exit(1)
    }
}

console.log(`Done: ${created} created, ${skipped} already existed. Migration marked complete.`)
