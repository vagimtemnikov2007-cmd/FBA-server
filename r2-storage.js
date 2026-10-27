import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";
import { readAnimationResponse } from "./animation-validation.js";

function jsonPrefix(env) {
    const prefix = (env.R2_JSON_PREFIX?.trim() || "jsons").replace(/^\/+|\/+$/g, "");
    if (!prefix || prefix.includes("\\") || prefix.includes("\0") || prefix.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid R2 JSON prefix");
    return prefix;
}
export const JSON_PREFIX = jsonPrefix(process.env);

export function encodeKey(key) {
    return key.split("/").map(encodeURIComponent).join("/");
}

export function validPublishedKey(key, prefix = JSON_PREFIX) {
    return typeof key === "string" && !key.includes("\\") && !key.includes("\0") &&
        key.split("/").every(part => part && part !== "." && part !== "..") &&
        (key.startsWith(`${prefix}/`) || key.startsWith("animations/")) && /\.json$/i.test(key);
}

export function createR2Storage({ env = process.env, request } = {}) {
    const bucket = env.R2_BUCKET_NAME?.trim() || "fba";
    const prefix = jsonPrefix(env);
    if (!validPublishedKey(`${prefix}/test.json`, prefix) || !/^[a-z0-9][a-z0-9.-]*$/.test(bucket)) throw new Error("Invalid R2 bucket or JSON prefix");
    const account = env.R2_ACCOUNT_ID?.trim();
    const base = `https://${account}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}`;
    const publicUrl = env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "");
    let client;
    function fetchR2(url, options = {}) {
        if (request) return request(url, options);
        if (!client) {
            if (!account || !/^[a-zA-Z0-9-]+$/.test(account) || !env.R2_ACCESS_KEY_ID?.trim() || !env.R2_SECRET_ACCESS_KEY?.trim()) throw Object.assign(new Error("Cloudflare R2 credentials are not configured"), { status: 503 });
            client = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(), service: "s3", region: "auto", retries: 1 });
        }
        return client.fetch(url, { signal: AbortSignal.timeout(12000), ...options });
    }
    return {
        prefix,
        async list() {
            const result = [], seen = new Set(); let token;
            const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });
            for (let page = 0; page < 8; page++) {
                const url = new URL(`${base}/`);
                url.searchParams.set("list-type", "2"); url.searchParams.set("prefix", `${prefix}/`);
                url.searchParams.set("encoding-type", "url"); url.searchParams.set("max-keys", "1000");
                if (token) url.searchParams.set("continuation-token", token);
                const response = await fetchR2(url, { method: "GET" });
                if (!response.ok) throw Object.assign(new Error(`Could not list R2 JSON files (${response.status})`), { status: 502 });
                const text = await response.text();
                if (text.length > 2000000 || /<!DOCTYPE/i.test(text)) throw new Error("Invalid R2 object listing");
                const root = parser.parse(text).ListBucketResult;
                if (!root || typeof root !== "object") throw new Error("Invalid R2 object listing");
                const contents = root.Contents ? (Array.isArray(root.Contents) ? root.Contents : [root.Contents]) : [];
                for (const object of contents) {
                    const key = root.EncodingType === "url" ? decodeURIComponent(object.Key) : object.Key;
                    if (!validPublishedKey(key, prefix) || !key.startsWith(`${prefix}/`) || seen.has(key)) continue;
                    seen.add(key);
                    result.push({ key, etag: object.ETag || null, size: Number(object.Size) });
                    if (result.length > 4096) throw new Error("R2 JSON catalog exceeds 4096 files");
                }
                if (root.IsTruncated !== "true") return result;
                const next = root.NextContinuationToken;
                if (!next || next === token) throw new Error("Invalid R2 listing continuation token");
                token = next;
            }
            throw new Error("R2 JSON listing exceeded its page limit");
        },
        keyFromUrl(source) {
            if (!publicUrl || typeof source !== "string") return null;
            try {
                const baseUrl = new URL(publicUrl + "/"), url = new URL(source);
                if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) return null;
                const key = decodeURIComponent(url.pathname.slice(baseUrl.pathname.length));
                return validPublishedKey(key, prefix) ? key : null;
            } catch { return null; }
        },
        async get(key) {
            if (!validPublishedKey(key, prefix)) throw Object.assign(new Error("Invalid published animation key"), { status: 404 });
            const response = await fetchR2(`${base}/${encodeKey(key)}`, { method: "GET" });
            return readAnimationResponse(response);
        },
    };
}
