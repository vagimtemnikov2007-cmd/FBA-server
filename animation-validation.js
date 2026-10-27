export const MAX_JSON_BYTES = 2 * 1024 * 1024;

export function animationValidationError(json) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return "Invalid animation JSON";
    if (typeof json.id !== "string" || !json.id.trim()) return "Animation JSON is missing id";
    const format = json.format ?? 1;
    if (![1, 2, 3].includes(format)) return "Unsupported animation format";
    const content = format === 3 ? json.tracks : json.transform;
    if (!content || typeof content !== "object" || Array.isArray(content)) return `Animation JSON is missing ${format === 3 ? "tracks" : "transform"}`;
    return null;
}

export async function readAnimationResponse(response) {
    if (!response.ok) throw Object.assign(new Error(`R2 returned ${response.status}`), { status: response.status === 404 ? 404 : 502 });
    if (Number(response.headers.get("content-length")) > MAX_JSON_BYTES) throw Object.assign(new Error("Animation JSON exceeds 2 MB"), { status: 413 });
    const reader = response.body?.getReader();
    let bytes;
    if (!reader) bytes = Buffer.from(await response.arrayBuffer());
    else {
        const chunks = []; let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MAX_JSON_BYTES) throw Object.assign(new Error("Animation JSON exceeds 2 MB"), { status: 413 });
                chunks.push(value);
            }
            bytes = Buffer.concat(chunks, size);
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
    }
    if (bytes.byteLength > MAX_JSON_BYTES) throw Object.assign(new Error("Animation JSON exceeds 2 MB"), { status: 413 });
    let json;
    try { json = JSON.parse(bytes.toString("utf8")); }
    catch { throw Object.assign(new Error("R2 object is not valid JSON"), { status: 422 }); }
    const error = animationValidationError(json);
    if (error) throw Object.assign(new Error(error), { status: 422 });
    return { json, bytes, etag: response.headers.get("etag") };
}
