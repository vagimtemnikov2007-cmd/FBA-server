import express from "express";
import { timingSafeEqual } from "node:crypto";

function keyMatches(actual, expected) {
    if (!actual || !expected || typeof actual !== "string") return false;
    const a = Buffer.from(actual), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

function downloads(row) {
    const value = Number(row.download_count);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function createdAt(row) { return Date.parse(row.created_at) || 0; }

export function createAnimationRouter({ catalog, env = process.env, logger = console }) {
    const router = express.Router();
    function baseUrl(req) {
        return (env.PUBLIC_API_URL?.trim() || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    }
    function failure(res, error) {
        logger.error("Animation request failed:", error.message);
        const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
        return res.status(status).json({ error: status === 404 || status === 413 || status === 422 ? error.message : "Could not load animations from Cloudflare R2" });
    }

    router.get("/animations", async (req, res) => {
        try {
            const rows = await catalog.entries(), origin = baseUrl(req);
            // Publish the order without publishing download totals. Equal totals favour newer uploads.
            const popularity = new Map([...rows].sort((a, b) => downloads(b.row) - downloads(a.row)
                || createdAt(b.row) - createdAt(a.row) || String(a.row.id).localeCompare(String(b.row.id)))
                .map(({ row }, index) => [row.id, index + 1]));
            res.set("Cache-Control", "public, max-age=30");
            return res.json(rows.map(({ row, key, revision }) => {
                const url = new URL(`${origin}/animations/${encodeURIComponent(row.id)}/json`);
                if (revision) url.searchParams.set("v", revision.replace(/^"|"$/g, ""));
                const download = new URL(url); download.searchParams.set("download", "1");
                const publicRow = { ...row }; delete publicRow.download_count;
                return { ...publicRow, popularity_rank: popularity.get(row.id), animation_url: url.href,
                    download_url: download.href, json_status: key ? "ready" : "missing" };
            }));
        } catch (error) { return failure(res, error); }
    });

    router.get("/animations/:id/json", async (req, res) => {
        try {
            const animation = await catalog.get(req.params.id);
            res.set({ "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff",
                "Cache-Control": "public, max-age=60, stale-while-revalidate=300", ETag: animation.etag });
            if (req.query.download === "1") res.attachment(animation.key.split("/").pop());
            const tags = req.get("If-None-Match")?.split(",").map(tag => tag.trim().replace(/^W\//, ""));
            if (tags?.some(tag => tag === "*" || tag === animation.etag)) return res.status(304).end();
            return res.send(animation.bytes);
        } catch (error) { return failure(res, error); }
    });

    router.post("/animations/cache/refresh", async (req, res) => {
        if (!keyMatches(req.get("x-cache-key"), env.CACHE_REFRESH_KEY)) return res.status(401).json({ error: "Unauthorized" });
        try {
            catalog.invalidate();
            const rows = await catalog.entries({ refresh: true });
            return res.json({ success: true, animationsCount: rows.length });
        } catch (error) { return failure(res, error); }
    });
    return router;
}
