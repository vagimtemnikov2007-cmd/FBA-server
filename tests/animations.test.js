import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import express from "express";
import cors from "cors";
import { createR2Storage, validPublishedKey } from "../r2-storage.js";
import { animationValidationError, MAX_JSON_BYTES, readAnimationResponse } from "../animation-validation.js";
import { createAnimationCatalog } from "../animation-catalog.js";
import { createAnimationRouter } from "../animation-routes.js";

const quiet = { error() {}, warn() {} };
const env = { R2_ACCOUNT_ID: "test-account", R2_BUCKET_NAME: "fba", R2_JSON_PREFIX: "jsons", R2_PUBLIC_URL: "https://cdn.example.test" };
const json = { format: 1, id: "custom:fall_over", name: "Fall Over", transform: { rotation: { x: "(1-t)*PI/2" } } };
const keysJson = { format: 3, id: "custom:pop", name: "Pop", tracks: { "material.opacity": { keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1 }] } } };
const bytes = data => Buffer.from(JSON.stringify(data));
function fixture({ name = "Fall Over", key = "jsons/fall_over.json", download = "https://drive.google.com/file/d/old/view" } = {}) {
    const state = { lists: 0, reads: 0, rows: 0, revision: "one", time: 100, broken: false, data: json };
    const storage = {
        prefix: "jsons",
        keyFromUrl: value => value.startsWith(env.R2_PUBLIC_URL + "/") ? value.slice(env.R2_PUBLIC_URL.length + 1) : null,
        async list() { state.lists++; if (state.broken) throw new Error("offline"); return [{ key, etag: state.revision, size: 100 }]; },
        async get(actual) { assert.equal(actual, key); state.reads++; await new Promise(resolve => setTimeout(resolve, 2)); return { json: state.data, bytes: bytes(state.data) }; },
    };
    const catalog = createAnimationCatalog({ storage, logger: quiet, now: () => state.time, ttl: 100,
        async loadRows() { state.rows++; return [{ id: "uuid-1", name, author: "Author", created_at: "2026-09-15", download_url: download }]; } });
    return { state, storage, catalog };
}

test("R2 listing uses bucket fba and prefix jsons, follows pagination and decodes filenames", async () => {
    let calls = 0;
    const storage = createR2Storage({ env, async request(source) {
        const url = new URL(source); calls++;
        assert.equal(url.pathname, "/fba/"); assert.equal(url.searchParams.get("prefix"), "jsons/");
        assert.equal(url.searchParams.get("encoding-type"), "url");
        if (calls === 1) return new Response('<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;page</NextContinuationToken><Contents><Key>jsons%2FFall%20Over.json</Key><Size>123</Size><ETag>"a"</ETag></Contents></ListBucketResult>');
        assert.equal(url.searchParams.get("continuation-token"), "next&page");
        return new Response('<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated><Contents><Key>submissions%2Fprivate.json</Key></Contents><Contents><Key>jsons%2Fpop.json</Key><Size>100</Size></Contents></ListBucketResult>');
    } });
    assert.deepEqual((await storage.list()).map(file => file.key), ["jsons/Fall Over.json", "jsons/pop.json"]);
    assert.equal(calls, 2);
});

test("only published JSON keys can be fetched; URLs cannot escape the configured bucket", async () => {
    for (const key of ["submissions/private.json", "jsons/../submissions/x.json", "jsons/a.webm", "jsons//a.json", "jsons/\\a.json"]) assert.equal(validPublishedKey(key), false, key);
    const storage = createR2Storage({ env, async request(url) {
        assert.equal(String(url), "https://test-account.r2.cloudflarestorage.com/fba/jsons/Fall%20Over.json");
        return new Response(JSON.stringify(json));
    } });
    assert.equal((await storage.get("jsons/Fall Over.json")).json.id, json.id);
    await assert.rejects(storage.get("submissions/private.json"), { status: 404 });
    assert.equal(storage.keyFromUrl("https://cdn.example.test/jsons/Fall%20Over.json"), "jsons/Fall Over.json");
    assert.equal(storage.keyFromUrl("https://other.example/jsons/x.json"), null);
    assert.equal(storage.keyFromUrl("https://cdn.example.test/submissions/private.json"), null);
    assert.throws(() => createR2Storage({ env: { ...env, R2_JSON_PREFIX: "../submissions" } }));
});

test("R2 errors, invalid pagination, HTML and oversized JSON fail cleanly", async () => {
    const denied = createR2Storage({ env, request: async () => new Response("denied", { status: 403 }) });
    await assert.rejects(denied.list(), /403/);
    const malformed = createR2Storage({ env, request: async () => new Response("<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>") });
    await assert.rejects(malformed.list(), /continuation/);
    await assert.rejects(readAnimationResponse(new Response("<html>error</html>")), { status: 422 });
    await assert.rejects(readAnimationResponse(new Response("{}", { headers: { "Content-Length": MAX_JSON_BYTES + 1 } })), { status: 413 });
    await assert.rejects(readAnimationResponse(new Response(" ".repeat(MAX_JSON_BYTES + 1))), { status: 413 });
    await assert.rejects(readAnimationResponse(new Response("missing", { status: 404 })), { status: 404 });
});

test("JSON formats 1/2/3 are accepted while malformed uploads are rejected", () => {
    assert.equal(animationValidationError(json), null); assert.equal(animationValidationError({ ...json, format: 2 }), null);
    assert.equal(animationValidationError(keysJson), null);
    for (const invalid of [null, [], {}, { id: "x" }, { ...json, format: 4 }, { format: 3, id: "x", tracks: [] }]) assert(animationValidationError(invalid));
});

test("legacy Google Drive cards match migrated R2 filenames without changing identity or metadata", async () => {
    const { catalog } = fixture(); const [entry] = await catalog.entries();
    assert.equal(entry.key, "jsons/fall_over.json"); assert.equal(entry.row.id, "uuid-1"); assert.equal(entry.row.author, "Author");
    const loaded = await catalog.get("uuid-1"); assert.deepEqual(JSON.parse(loaded.bytes), json);
});

test("arbitrary filenames are resolved from the real JSON name/id", async () => {
    const { catalog, state } = fixture({ name: "Fall Over", key: "jsons/random-upload-name.json" });
    assert.equal((await catalog.entries())[0].key, "jsons/random-upload-name.json"); assert.equal(state.reads, 1);
    await catalog.get("uuid-1"); assert.equal(state.reads, 1);
});

test("ambiguous names and missing JSON never resolve to an arbitrary animation", async () => {
    const { storage } = fixture(); storage.list = async () => ["jsons/fall-over.json", "jsons/fall_over.json"].map(key => ({ key }));
    storage.get = async () => ({ json, bytes: bytes(json) });
    const catalog = createAnimationCatalog({ storage, logger: quiet, loadRows: async () => [{ id: "uuid", name: "Fall Over", download_url: "old" }] });
    assert.equal((await catalog.entries())[0].key, null);
    await assert.rejects(catalog.get("uuid"), { status: 404 });
    await assert.rejects(catalog.get("unknown"), { status: 404 });
});

test("known R2 paths preserve new uploads and legacy published JSON paths", async () => {
    const { catalog } = fixture({ name: "Custom display name", key: "jsons/uuid-original.json", download: "https://cdn.example.test/jsons/uuid-original.json" });
    assert.equal((await catalog.entries())[0].key, "jsons/uuid-original.json");
    assert.equal(validPublishedKey("animations/old-published.json"), true);
});

test("catalog/payload requests are deduplicated and changed object revisions refresh cached JSON", async () => {
    const { catalog, state } = fixture();
    const [a, b] = await Promise.all([catalog.get("uuid-1"), catalog.get("uuid-1")]);
    assert.equal(state.lists, 1); assert.equal(state.rows, 1); assert.equal(state.reads, 1); assert.equal(a.etag, b.etag);
    state.time += 101; state.revision = "two"; state.data = { ...json, name: "Updated" };
    const changed = await catalog.get("uuid-1"); assert.notEqual(changed.etag, a.etag); assert.equal(state.reads, 2);
    state.time += 101; state.broken = true;
    assert.equal((await catalog.entries())[0].row.id, "uuid-1");
});

test("a publish invalidation cannot be overwritten by an earlier pending catalog request", async () => {
    const { storage } = fixture(); let finish, calls = 0;
    const catalog = createAnimationCatalog({ storage, logger: quiet, loadRows() {
        if (++calls === 1) return new Promise(resolve => { finish = resolve; });
        return Promise.resolve([{ id: "new", name: "Fall Over", download_url: "old" }]);
    } });
    const old = catalog.entries(); catalog.invalidate();
    const fresh = await catalog.entries(); assert.equal(fresh[0].row.id, "new");
    finish([{ id: "old", name: "Fall Over", download_url: "old" }]); await old;
    assert.equal((await catalog.entries())[0].row.id, "new");
});

async function serve(router, run) {
    const app = express(); app.set("trust proxy", 1); app.use(cors()); app.use(express.json()); app.use(router);
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try { return await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test("HTTP catalog publishes HTTPS API JSON URLs, original downloads, ETags and CORS", async () => {
    const { catalog } = fixture();
    const router = createAnimationRouter({ catalog, env: { PUBLIC_API_URL: "https://api.example.test" }, logger: quiet });
    await serve(router, async base => {
        const response = await fetch(base + "/animations", { headers: { Origin: "https://freshblockanimations.com" } });
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        const [row] = await response.json(); assert.equal(row.id, "uuid-1"); assert.equal(row.json_status, "ready");
        const preview = new URL(row.animation_url); assert.equal(preview.origin, "https://api.example.test"); assert.equal(preview.searchParams.get("v"), "one");
        const content = await fetch(base + preview.pathname); assert.equal(content.status, 200); assert.deepEqual(await content.json(), json);
        const conditional = await fetch(base + preview.pathname, { headers: { "If-None-Match": content.headers.get("etag") } }); assert.equal(conditional.status, 304);
        const download = await fetch(base + new URL(row.download_url).pathname + "?download=1");
        assert.match(download.headers.get("content-disposition"), /attachment.*fall_over\.json/); assert.deepEqual(await download.json(), json);
        assert.equal((await fetch(base + "/animations/missing/json")).status, 404);
    });
});

test("HTTP refresh requires a configured secret and does not modify caches when unauthorized", async () => {
    const { catalog, state } = fixture();
    await serve(createAnimationRouter({ catalog, env: { CACHE_REFRESH_KEY: "test-secret" }, logger: quiet }), async base => {
        assert.equal((await fetch(base + "/animations/cache/refresh", { method: "POST" })).status, 401); assert.equal(state.lists, 0);
        assert.equal((await fetch(base + "/animations/cache/refresh", { method: "POST", headers: { "x-cache-key": "test-secret" } })).status, 200); assert.equal(state.lists, 1);
    });
    await serve(createAnimationRouter({ catalog, env: {}, logger: quiet }), async base => {
        assert.equal((await fetch(base + "/animations/cache/refresh", { method: "POST" })).status, 401);
    });
});

test("HTTP catalog ranks by downloads, breaks ties by date and never exposes download counts", async () => {
    const rows = [
        { id: "new-low", name: "Newest", created_at: "2026-10-27", download_count: 4 },
        { id: "popular-old", name: "Popular older", created_at: "2026-09-01", download_count: 420 },
        { id: "popular-new", name: "Popular newer", created_at: "2026-10-01", download_count: "420" },
        { id: "zero", name: "No downloads", created_at: "2026-10-20", download_count: null },
        { id: "missing", name: "Missing counter", created_at: "2026-10-19" },
    ];
    const before = JSON.stringify(rows);
    const entries = rows.map(row => ({ row, key: `jsons/${row.id}.json` }));
    const catalog = { entries: async () => entries };
    await serve(createAnimationRouter({ catalog, env: {}, logger: quiet }), async base => {
        const response = await fetch(base + "/animations"); assert.equal(response.status, 200);
        const cards = await response.json();
        assert.deepEqual([...cards].sort((a, b) => a.popularity_rank - b.popularity_rank).map(row => row.id),
            ["popular-new", "popular-old", "new-low", "zero", "missing"]);
        assert(cards.every(card => !Object.hasOwn(card, "download_count")));
        assert.equal(JSON.stringify(rows), before, "public projection must not mutate the cached database rows");
        // Counts read by the next catalog snapshot change the rank without a schema migration.
        rows[0].download_count = 421;
        const updated = await (await fetch(base + "/animations")).json();
        assert.equal(updated.find(row => row.id === "new-low").popularity_rank, 1);
    });
});

test("unknown configuration returns a controlled error without exposing credentials", async () => {
    const storage = createR2Storage({ env: { R2_BUCKET_NAME: "fba" } });
    const catalog = createAnimationCatalog({ storage, loadRows: async () => [], logger: quiet });
    await serve(createAnimationRouter({ catalog, env: {}, logger: quiet }), async base => {
        const response = await fetch(base + "/animations"); assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "Could not load animations from Cloudflare R2" });
    });
});
