import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.get("/animations", async (req, res) => {
    const { data, error } = await supabase
    .from("animations")
    .select(`
        id,
        name,
        download_url,
        preview_url,
        author,
        created_at
    `)
    .order("created_at", {ascending: false})

    if(error){
         console.error("Error fetching animations:", error);

        return res.status(500).json({
            error: "Error fetching animations"
        })
    }
    res.json(data ?? []);
});



export default router;