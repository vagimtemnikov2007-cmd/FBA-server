import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import express from "express";

test("admin publication, pending uploads and approval accept format 3 and publish to jsons", async () => {
    const settings = { SUPABASE_URL: "https://supabase.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only-key", ADMIN_KEY: "test-admin",
        R2_ACCOUNT_ID: "test-account", R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret",
        R2_BUCKET_NAME: "fba", R2_JSON_PREFIX: "jsons", R2_PUBLIC_URL: "https://cdn.example.test" };
    const old = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
    const originalFetch = globalThis.fetch, published = [], uploaded = [];
    const definition = { format: 3, id: "custom:pop", name: "Pop", tracks: { "material.opacity": 1 } };
    const contents = new Map([["submissions/source.json", Buffer.from(JSON.stringify(definition))]]);
    const submission = { id: "pending", name: "Pop", author: "Tester", mail: "test@example.test", status: "pending", storage_path: "submissions/source.json" };
    globalThis.fetch = async (input, init) => {
        const req = new Request(input, init), url = new URL(req.url);
        if (url.hostname === "127.0.0.1") return originalFetch(req);
        if (url.hostname === "supabase.example.test") {
            const table = url.pathname.split("/").pop();
            if (table === "admin_visitors") return Response.json(url.searchParams.get("visitor_id") === "eq.admin" ? [{ id: "admin-row" }] : []);
            if (table === "animations" && req.method === "POST") {
                const record = { ...await req.json(), id: `published-${published.length}`, created_at: "2026-10-27" };
                published.push(record); return Response.json(record, { status: 201 });
            }
            if (table === "animations" && req.method === "GET") return Response.json(published);
            if (table === "animation_submissions" && req.method === "POST") return Response.json({ ...await req.json(), id: "new-pending" }, { status: 201 });
            if (table === "animation_submissions" && req.method === "GET") return Response.json([submission]);
            if (table === "animation_submissions" && req.method === "PATCH") { Object.assign(submission, await req.json()); return new Response(null, { status: 204 }); }
            throw new Error(`Unexpected fake database request: ${req.method} ${table}`);
        }
        if (url.hostname === "test-account.r2.cloudflarestorage.com") {
            const key = decodeURIComponent(url.pathname.slice("/fba/".length));
            if (url.searchParams.has("list-type")) {
                return new Response(`<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${[...contents].filter(([name]) => name.startsWith("jsons/")).map(([name, data]) => `<Contents><Key>${encodeURIComponent(name)}</Key><Size>${data.length}</Size><ETag>test</ETag></Contents>`).join("")}</ListBucketResult>`);
            }
            if (req.method === "PUT") { uploaded.push(key); contents.set(key, Buffer.from(await req.arrayBuffer())); return new Response(null, { status: 200 }); }
            if (req.method === "GET") return new Response(contents.get(key) || "missing", { status: contents.has(key) ? 200 : 404 });
            if (req.method === "DELETE") { contents.delete(key); return new Response(null, { status: 204 }); }
        }
        throw new Error("Tests block every other network destination");
    };
    let server;
    try {
        const { default: admin } = await import("../admin.js");
        const { default: submissions } = await import("../sumbitssions.js");
        const { animationCatalog } = await import("../animations.js");
        const app = express(); app.use(express.json()); app.use(admin, submissions);
        server = app.listen(0, "127.0.0.1"); await once(server, "listening");
        const base = `http://127.0.0.1:${server.address().port}`;
        function form(visitor = "admin", json = definition) {
            const result = new FormData();
            for (const [key, value] of Object.entries({ visitorId: visitor, name: "Pop", author: "Tester", mail: "test@example.test" })) result.set(key, value);
            result.set("file", new Blob([JSON.stringify(json)], { type: "application/json" }), "pop.json"); return result;
        }
        assert.equal((await animationCatalog.entries()).length, 0);
        const denied = await fetch(base + "/admin/animations", { method: "POST", body: form("intruder") });
        assert.equal(denied.status, 403); assert.equal(uploaded.length, 0);
        const direct = await fetch(base + "/admin/animations", { method: "POST", body: form() });
        assert.equal(direct.status, 201, JSON.stringify(await direct.json()));
        assert.match(uploaded[0], /^jsons\/.+-pop\.json$/);
        assert.equal((await animationCatalog.entries()).length, 1, "Publication did not invalidate catalog cache");
        const pending = await fetch(base + "/submitAnimation", { method: "POST", body: form() });
        assert.equal(pending.status, 201, JSON.stringify(await pending.json())); assert.match(uploaded[1], /^submissions\//);
        const count = uploaded.length;
        const invalid = await fetch(base + "/submitAnimation", { method: "POST", body: form("admin", { ...definition, format: 999 }) });
        assert.equal(invalid.status, 400); assert.equal(uploaded.length, count);
        const approved = await fetch(base + "/admin/submissions/pending/approve", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: "admin" }),
        });
        const result = await approved.json(); assert.equal(approved.status, 200, JSON.stringify(result));
        assert.equal(result.storage.newPath, "jsons/source.json"); assert.equal(submission.status, "approved");
        assert(!contents.has("submissions/source.json")); assert.deepEqual(JSON.parse(contents.get("jsons/source.json")), definition);
        assert.equal((await animationCatalog.entries()).length, 2, "Approval did not invalidate catalog cache");
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});
