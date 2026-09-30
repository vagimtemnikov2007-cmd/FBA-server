import express from "express";
import crypto from "crypto";
import multer from "multer";
import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";


const router = express.Router();


// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


// =====================================================
// ADMIN
// =====================================================

const ADMIN_KEY =
    process.env.ADMIN_KEY?.trim();


// =====================================================
// R2
// =====================================================

const ACCOUNT_ID =
    process.env.R2_ACCOUNT_ID?.trim();

const ACCESS_KEY_ID =
    process.env.R2_ACCESS_KEY_ID?.trim();

const SECRET_ACCESS_KEY =
    process.env.R2_SECRET_ACCESS_KEY?.trim();

const BUCKET =
    process.env.R2_BUCKET_NAME?.trim() || "fba";

const R2_PUBLIC_URL =
    process.env.R2_PUBLIC_URL
        ?.trim()
        .replace(/\/$/, "");


const R2_URL =
    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;


const r2 = new AwsClient({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
});


// =====================================================
// CONFIG CHECK
// =====================================================

if (!ADMIN_KEY) {
    throw new Error(
        "Missing ADMIN_KEY"
    );
}

if (!ACCOUNT_ID) {
    throw new Error(
        "Missing R2_ACCOUNT_ID"
    );
}

if (!ACCESS_KEY_ID) {
    throw new Error(
        "Missing R2_ACCESS_KEY_ID"
    );
}

if (!SECRET_ACCESS_KEY) {
    throw new Error(
        "Missing R2_SECRET_ACCESS_KEY"
    );
}

if (!R2_PUBLIC_URL) {
    throw new Error(
        "Missing R2_PUBLIC_URL"
    );
}


// =====================================================
// MULTER
// =====================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 2 * 1024 * 1024,
    },

    fileFilter: (
        req,
        file,
        callback
    ) => {
        const fileName =
            file.originalname.toLowerCase();

        if (!fileName.endsWith(".json")) {
            return callback(
                new Error(
                    "Only .json files are allowed"
                )
            );
        }

        callback(null, true);
    },
});


// =====================================================
// SAFE ADMIN KEY COMPARISON
// =====================================================

function compareKeys(
    inputKey,
    realKey
) {
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

    if (
        inputBuffer.length !==
        realBuffer.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        inputBuffer,
        realBuffer
    );
}


// =====================================================
// CHECK VISITOR IS ADMIN
// =====================================================

async function isVisitorAdmin(
    visitorId
) {
    if (!visitorId) {
        return false;
    }

    const {
        data,
        error,
    } = await supabase
        .from("admin_visitors")
        .select("id")
        .eq(
            "visitor_id",
            visitorId
        )
        .maybeSingle();


    if (error) {
        console.error(
            "Admin database check error:",
            error
        );

        throw error;
    }


    return Boolean(data);
}


// =====================================================
// ADMIN MIDDLEWARE
// =====================================================

async function requireAdmin(
    req,
    res,
    next
) {
    try {
        const visitorId =
            req.body?.visitorId;

        if (!visitorId) {
            return res
                .status(401)
                .json({
                    error:
                        "visitorId is required",
                });
        }


        const admin =
            await isVisitorAdmin(
                visitorId
            );


        if (!admin) {
            return res
                .status(403)
                .json({
                    error:
                        "Admin access required",
                });
        }


        next();

    } catch (error) {
        console.error(
            "Admin authorization error:",
            error
        );

        return res
            .status(500)
            .json({
                error:
                    "Failed to authorize admin",
            });
    }
}


// =====================================================
// REGISTER ADMIN
// =====================================================

router.post(
    "/admin/register",

    async (req, res) => {
        try {
            const {
                adminKey,
                visitorId,
            } = req.body;


            // -------------------------
            // VALIDATION
            // -------------------------

            if (
                !adminKey ||
                !visitorId
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "adminKey and visitorId are required",
                    });
            }


            // -------------------------
            // CHECK SECRET KEY
            // -------------------------

            if (
                !compareKeys(
                    adminKey,
                    ADMIN_KEY
                )
            ) {
                console.warn(
                    "Invalid admin registration attempt:",
                    visitorId
                );

                return res
                    .status(403)
                    .json({
                        error:
                            "Invalid admin key",
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
                .select(
                    "id, visitor_id, created_at"
                )
                .eq(
                    "visitor_id",
                    visitorId
                )
                .maybeSingle();


            if (checkError) {
                console.error(
                    "Admin check error:",
                    checkError
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to check admin",
                    });
            }


            if (existingAdmin) {
                return res.json({
                    message:
                        "Visitor is already an admin",

                    admin:
                        existingAdmin,
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
                    visitor_id:
                        visitorId,
                })
                .select()
                .single();


            if (insertError) {
                console.error(
                    "Admin insert error:",
                    insertError
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to register admin",
                    });
            }


            console.log(
                "New admin registered:",
                visitorId
            );


            return res
                .status(201)
                .json({
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

            return res
                .status(500)
                .json({
                    error:
                        error.message ||
                        "Internal server error",
                });
        }
    }
);


// =====================================================
// CHECK ADMIN
// =====================================================

router.post(
    "/admin/check",

    async (req, res) => {
        try {
            const {
                visitorId,
            } = req.body;


            if (!visitorId) {
                return res
                    .status(400)
                    .json({
                        error:
                            "visitorId is required",
                    });
            }


            const admin =
                await isVisitorAdmin(
                    visitorId
                );


            return res.json({
                admin,
            });

        } catch (error) {
            console.error(
                "Admin check error:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Internal server error",
                });
        }
    }
);


// =====================================================
// ADD ANIMATION DIRECTLY
// =====================================================

router.post(
    "/admin/animations",

    /*
        visitorId приходит внутри FormData,
        поэтому multer должен обработать
        запрос ДО requireAdmin.
    */
    upload.single("file"),

    requireAdmin,

    async (req, res) => {
        let uploadedKey = null;

        try {
            const {
                name,
                author,
                mail,
            } = req.body;

            const file =
                req.file;


            // ---------------------------------
            // BASIC VALIDATION
            // ---------------------------------

            if (
                !name?.trim() ||
                !author?.trim() ||
                !mail?.trim() ||
                !file
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Missing required fields",
                    });
            }


            // ---------------------------------
            // JSON PARSE
            // ---------------------------------

            let animationJson;

            try {
                animationJson =
                    JSON.parse(
                        file.buffer.toString(
                            "utf-8"
                        )
                    );

            } catch {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid JSON file",
                    });
            }


            // ---------------------------------
            // JSON VALIDATION
            // ---------------------------------

            if (
                typeof animationJson !==
                    "object" ||
                animationJson === null
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid animation JSON",
                    });
            }


            if (!animationJson.id) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Animation JSON is missing id",
                    });
            }


            if (!animationJson.transform) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Animation JSON is missing transform",
                    });
            }


            console.log(
                "Admin publishing animation:",
                animationJson.id
            );


            // ---------------------------------
            // FILE NAME
            // ---------------------------------

            const safeName =
                file.originalname.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );


            const fileName =
                `${crypto.randomUUID()}-${safeName}`;


            const key =
                `animations/${fileName}`;


            uploadedKey =
                key;


            // ---------------------------------
            // UPLOAD TO R2
            // ---------------------------------

            const uploadUrl =
                `${R2_URL}/${BUCKET}/${key}`;


            const uploadResponse =
                await r2.fetch(
                    uploadUrl,
                    {
                        method: "PUT",

                        headers: {
                            "Content-Type":
                                "application/json",
                        },

                        body:
                            file.buffer,
                    }
                );


            if (!uploadResponse.ok) {
                const responseText =
                    await uploadResponse.text();


                console.error(
                    "R2 upload failed:",
                    uploadResponse.status,
                    responseText
                );


                return res
                    .status(500)
                    .json({
                        error:
                            `R2 upload failed (${uploadResponse.status})`,
                    });
            }


            console.log(
                "R2 animation upload success:",
                key
            );


            // ---------------------------------
            // DOWNLOAD URL
            // ---------------------------------

            const encodedKey =
                key
                    .split("/")
                    .map(
                        encodeURIComponent
                    )
                    .join("/");


            const downloadUrl =
                `${R2_PUBLIC_URL}/${encodedKey}`;


            // ---------------------------------
            // SAVE TO ANIMATIONS
            // ---------------------------------

            const {
                data,
                error: databaseError,
            } = await supabase
                .from("animations")
                .insert({
                    name:
                        name.trim(),

                    author:
                        author.trim(),

                    mail:
                        mail.trim(),

                    download_url:
                        downloadUrl,
                })
                .select()
                .single();


            // ---------------------------------
            // DATABASE FAILED
            // ---------------------------------

            if (databaseError) {
                console.error(
                    "Animation database error:",
                    databaseError
                );


                try {
                    await r2.fetch(
                        uploadUrl,
                        {
                            method:
                                "DELETE",
                        }
                    );

                } catch (
                    cleanupError
                ) {
                    console.error(
                        "R2 cleanup error:",
                        cleanupError
                    );
                }


                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to save animation",
                    });
            }


            // ---------------------------------
            // SUCCESS
            // ---------------------------------

            console.log(
                "Animation published:",
                data.id
            );


            return res
                .status(201)
                .json({
                    message:
                        "Animation published successfully",

                    animation:
                        data,
                });


        } catch (error) {
            console.error(
                "Admin animation upload error:",
                error
            );


            // ---------------------------------
            // CLEANUP R2
            // ---------------------------------

            if (uploadedKey) {
                try {
                    const deleteUrl =
                        `${R2_URL}/${BUCKET}/${uploadedKey}`;


                    await r2.fetch(
                        deleteUrl,
                        {
                            method:
                                "DELETE",
                        }
                    );

                } catch (
                    cleanupError
                ) {
                    console.error(
                        "R2 cleanup error:",
                        cleanupError
                    );
                }
            }


            return res
                .status(500)
                .json({
                    error:
                        error.message ||
                        "Internal server error",
                });
        }
    }
);

// =====================================================
// GET PENDING SUBMISSIONS
// =====================================================

router.post(
    "/admin/submissions",
    requireAdmin,
    async (req, res) => {
        try {
            const {
                data,
                error,
            } = await supabase
                .from("animation_submissions")
                .select("*");

            console.log(
                "ALL SUBMISSIONS:",
                data
            );

            console.log(
                "SUBMISSIONS ERROR:",
                error
            );

            if (error) {
                return res.status(500).json({
                    error: error.message,
                });
            }

            const pending = data.filter(
                (submission) =>
                    submission.status === "pending"
            );

            console.log(
                "PENDING SUBMISSIONS:",
                pending
            );

            return res.json({
                submissions: pending,
                count: pending.length,
            });

        } catch (error) {
            console.error(
                "Submissions route error:",
                error
            );

            return res.status(500).json({
                error:
                    error.message ||
                    "Internal server error",
            });
        }
    }
);


export default router;