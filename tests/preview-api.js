// Read-only local fixture API for browser integration. No real R2 or Supabase.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import cors from "cors";
import { createAnimationCatalog } from "../animation-catalog.js";
import { createAnimationRouter } from "../animation-routes.js";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the directory containing animation JSON fixtures");
const files = readdirSync(directory).filter(name => name.endsWith(".json")).map(name => {
    const bytes = readFileSync(path.join(directory, name));
    return { key: `jsons/${name}`, bytes, json: JSON.parse(bytes), size: bytes.length, etag: createHash("sha256").update(bytes).digest("hex") };
});
const storage = {
    prefix: "jsons",
    keyFromUrl: () => null,
    list: async () => files.map(({ key, size, etag }) => ({ key, size, etag })),
    get: async key => { const file = files.find(item => item.key === key); if (!file) throw new Error("Missing fixture"); return file; },
};
const catalog = createAnimationCatalog({ storage, loadRows: async () => files.map((file, index) => ({
    id: `fixture-${index}`, name: file.json.name, author: "Fresh Block Animations", created_at: "2026-09-15T19:00:00Z",
    download_url: `https://drive.google.com/file/d/legacy-${index}/view`, preview_url: "https://example.invalid/old.webm",
})) });
const app = express(); app.use(cors()); app.use(express.json());
app.get("/", (req, res) => res.json({ fixtureAPI: true }));
app.post(["/visitors", "/downloads", "/admin/check"], (req, res) => res.json({ success: true, admin: false }));
app.use(createAnimationRouter({ catalog, env: {} }));
const server = app.listen(0, "127.0.0.1", () => console.log(`FBA_TEST_API_URL=http://127.0.0.1:${server.address().port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
