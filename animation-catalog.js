import { createHash } from "node:crypto";
import { MAX_JSON_BYTES } from "./animation-validation.js";

const identity = value => typeof value === "string" ? value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") : "";
const fileIdentity = key => key.split("/").pop().replace(/\.json$/i, "").replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, "");
const httpError = (message, status) => Object.assign(new Error(message), { status });

export function createAnimationCatalog({ loadRows, storage, now = Date.now, ttl = 60000, logger = console }) {
    let snapshot = null, updatedAt = 0, loading = null, generation = 0, cacheBytes = 0;
    const payloads = new Map(), pending = new Map();

    async function payload(key, revision = "") {
        const cacheKey = `${key}\0${revision}`;
        const cached = payloads.get(cacheKey);
        if (cached && now() - cached.updatedAt < ttl) {
            payloads.delete(cacheKey); payloads.set(cacheKey, cached); return cached;
        }
        if (pending.has(cacheKey)) return pending.get(cacheKey);
        const token = generation;
        const job = (async () => {
            const loaded = await storage.get(key);
            const value = { bytes: loaded.bytes, id: loaded.json.id, name: loaded.json.name,
                etag: `"${createHash("sha256").update(loaded.bytes).digest("hex")}"`, updatedAt: now() };
            if (generation !== token) return value;
            const old = payloads.get(cacheKey);
            if (old) cacheBytes -= old.bytes.length;
            payloads.delete(cacheKey); payloads.set(cacheKey, value); cacheBytes += value.bytes.length;
            while (cacheBytes > 32 * 1024 * 1024 || payloads.size > 128) {
                const first = payloads.keys().next().value;
                cacheBytes -= payloads.get(first).bytes.length; payloads.delete(first);
            }
            return value;
        })();
        pending.set(cacheKey, job);
        try { return await job; } finally { if (pending.get(cacheKey) === job) pending.delete(cacheKey); }
    }

    async function build() {
        const rows = await loadRows();
        if (!Array.isArray(rows)) throw httpError("Invalid animation database response", 502);
        const files = await storage.list();
        const byKey = new Map(files.map(file => [file.key, file]));
        const aliases = new Map();
        function add(alias, key) {
            const name = identity(alias); if (!name) return;
            if (!aliases.has(name)) aliases.set(name, new Set());
            aliases.get(name).add(key);
        }
        function match(row) {
            const keys = new Set([...(aliases.get(identity(row.name)) ?? []), ...(aliases.get(identity(row.id)) ?? [])]);
            return keys.size === 1 ? [...keys][0] : null;
        }
        for (const file of files) add(fileIdentity(file.key), file.key);
        const entries = rows.map(row => ({ row: { ...row }, key: storage.keyFromUrl(row.download_url) || match(row) }));
        const unresolved = entries.filter(entry => !entry.key);
        if (unresolved.length) {
            // Arbitrary migrated filenames are resolved using their actual JSON
            // name/id. Read at most four small files concurrently.
            const candidates = files.filter(file => !Number.isFinite(file.size) || file.size <= MAX_JSON_BYTES).slice(0, 512);
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
                while (cursor < candidates.length) {
                    const file = candidates[cursor++];
                    try {
                        const value = await payload(file.key, file.etag);
                        add(value.name, file.key); add(value.id, file.key); add(value.id?.split(":").pop(), file.key);
                    } catch (error) { logger.warn("Skipping invalid R2 animation:", file.key, error.message); }
                }
            }));
            for (const entry of unresolved) entry.key = match(entry.row);
        }
        return entries.map(entry => ({ ...entry, revision: entry.key ? byKey.get(entry.key)?.etag || "" : "" }));
    }

    async function entries({ refresh = false } = {}) {
        if (!refresh && snapshot && now() - updatedAt < ttl) return snapshot;
        if (loading) return loading;
        const token = generation;
        const job = build().then(result => {
            if (generation === token) { snapshot = result; updatedAt = now(); }
            return result;
        });
        loading = job;
        try { return await job; }
        catch (error) {
            if (!refresh && snapshot) { logger.warn("Serving the last valid animation catalog:", error.message); return snapshot; }
            throw error;
        } finally { if (loading === job) loading = null; }
    }

    return {
        entries,
        invalidate() { generation++; snapshot = null; updatedAt = 0; loading = null; payloads.clear(); pending.clear(); cacheBytes = 0; },
        async get(id) {
            const entry = (await entries()).find(item => String(item.row.id) === id);
            if (!entry) throw httpError("Animation not found", 404);
            if (!entry.key) throw httpError(`Animation JSON was not found in Cloudflare ${storage.prefix}/`, 404);
            return { ...entry, ...await payload(entry.key, entry.revision) };
        },
    };
}
