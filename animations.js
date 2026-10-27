import { createClient } from "@supabase/supabase-js";
import { createR2Storage } from "./r2-storage.js";
import { createAnimationCatalog } from "./animation-catalog.js";
import { createAnimationRouter } from "./animation-routes.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const animationCatalog = createAnimationCatalog({
    storage: createR2Storage(),
    async loadRows() {
        const { data, error } = await supabase.from("animations")
            .select("id,name,download_url,preview_url,author,created_at").order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
    },
});

export default createAnimationRouter({ catalog: animationCatalog });
