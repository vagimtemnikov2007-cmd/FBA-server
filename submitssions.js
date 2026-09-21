import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


// SUBMIT ANIMATION
router.post("/submitAnimation", async (req, res) => {
    try {
        const {
            name,
            author,
            mail,
            download_url,
            preview_url
        } = req.body;

        // Простая проверка
        if (!name || !author || !mail || !download_url) {
            return res.status(400).json({
                error: "Missing required fields"
            });
        }

        const { data, error } = await supabase
            .from("animation_submissions")
            .insert({
                name,
                author,
                mail,
                download_url,
                preview_url: preview_url || null,
                status: "pending"
            })
            .select()
            .single();

        if (error) {
            console.error("Supabase error:", error);

            return res.status(500).json({
                error: "Failed to submit animation"
            });
        }

        return res.status(201).json({
            message: "Animation submitted successfully",
            submission: data
        });

    } catch (error) {
        console.error("Submit animation error:", error);

        return res.status(500).json({
            error: "Internal server error"
        });
    }
});


export default router;