import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_KEY = process.env.ADMIN_KEY;


// ---------------------------------
// CONFIG CHECK
// ---------------------------------

if (!ADMIN_KEY) {
    throw new Error("Missing ADMIN_KEY");
}


// ---------------------------------
// SAFE KEY COMPARISON
// ---------------------------------

function compareKeys(inputKey, realKey) {
    if (
        typeof inputKey !== "string" ||
        typeof realKey !== "string"
    ) {
        return false;
    }

    const inputBuffer =
        Buffer.from(inputKey);

    const realBuffer =
        Buffer.from(realKey);

    if (inputBuffer.length !== realBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        inputBuffer,
        realBuffer
    );
}


// ---------------------------------
// REGISTER ADMIN
// ---------------------------------

router.post("/admin/register", async (req, res) => {
    try {
        const {
            adminKey,
            visitorId,
        } = req.body;


        // -------------------------
        // VALIDATION
        // -------------------------

        if (!adminKey || !visitorId) {
            return res.status(400).json({
                error:
                    "adminKey and visitorId are required",
            });
        }


        // -------------------------
        // CHECK ADMIN KEY
        // -------------------------

        if (!compareKeys(adminKey, ADMIN_KEY)) {
            console.warn(
                "Invalid admin registration attempt:",
                visitorId
            );

            return res.status(403).json({
                error: "Invalid admin key",
            });
        }


        // -------------------------
        // CHECK EXISTING ADMIN
        // -------------------------

        const {
            data: existingAdmin,
            error: checkError,
        } = await supabase
            .from("admin_visitors")
            .select("id, visitor_id, created_at")
            .eq("visitor_id", visitorId)
            .maybeSingle();


        if (checkError) {
            console.error(
                "Admin check error:",
                checkError
            );

            return res.status(500).json({
                error:
                    "Failed to check admin",
            });
        }


        if (existingAdmin) {
            return res.status(200).json({
                message:
                    "Visitor is already an admin",

                admin: existingAdmin,
            });
        }


        // -------------------------
        // CREATE ADMIN
        // -------------------------

        const {
            data,
            error: insertError,
        } = await supabase
            .from("admin_visitors")
            .insert({
                visitor_id: visitorId,
            })
            .select()
            .single();


        if (insertError) {
            console.error(
                "Admin insert error:",
                insertError
            );

            return res.status(500).json({
                error:
                    "Failed to register admin",
            });
        }


        console.log(
            "New admin registered:",
            visitorId
        );


        return res.status(201).json({
            message:
                "Admin registered successfully",

            admin: {
                id: data.id,
                visitorId:
                    data.visitor_id,

                createdAt:
                    data.created_at,
            },
        });

    } catch (error) {
        console.error(
            "Admin registration error:",
            error
        );

        return res.status(500).json({
            error:
                error.message ||
                "Internal server error",
        });
    }
});


// ---------------------------------
// CHECK ADMIN
// ---------------------------------

router.post("/admin/check", async (req, res) => {
    try {
        const {
            visitorId,
        } = req.body;


        if (!visitorId) {
            return res.status(400).json({
                error:
                    "visitorId is required",
            });
        }


        const {
            data,
            error,
        } = await supabase
            .from("admin_visitors")
            .select("id")
            .eq("visitor_id", visitorId)
            .maybeSingle();


        if (error) {
            console.error(
                "Admin check error:",
                error
            );

            return res.status(500).json({
                error:
                    "Failed to check admin",
            });
        }


        return res.json({
            admin: Boolean(data),
        });

    } catch (error) {
        console.error(
            "Admin check error:",
            error
        );

        return res.status(500).json({
            error:
                "Internal server error",
        });
    }
});


export default router;