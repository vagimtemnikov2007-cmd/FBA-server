import express from "express";
import crypto from "crypto";
import multer from "multer";
import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";


const router = express.Router();


const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


const ADMIN_KEY =
    process.env.ADMIN_KEY?.trim();



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

router.post("/admin/check", async (req, res) => {
    try {
        console.log(
            "[ADMIN CHECK] body:",
            req.body
        );

        const visitorId =
            req.body?.visitorId;


        if (!visitorId) {
            return res.status(400).json({
                error:
                    "visitorId is required",
            });
        }


        console.log(
            "[ADMIN CHECK] visitorId:",
            visitorId
        );


        const {
            data,
            error,
        } = await supabase
            .from("admin_visitors")
            .select("id, visitor_id")
            .eq(
                "visitor_id",
                visitorId
            )
            .maybeSingle();


        if (error) {
            console.error(
                "[ADMIN CHECK] Supabase error:",
                error
            );

            return res.status(500).json({
                error:
                    "Failed to check admin",

                details:
                    error.message,
            });
        }


        console.log(
            "[ADMIN CHECK] result:",
            data
        );


        return res.json({
            admin:
                Boolean(data),
        });


    } catch (error) {

        console.error(
            "[ADMIN CHECK] INTERNAL ERROR:",
            error
        );


        return res.status(500).json({
            error:
                "Internal server error",

            details:
                error.message,
        });
    }
});


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

            // ---------------------------------
            // GET PENDING SUBMISSIONS
            // ---------------------------------

            const {
                data,
                error,
            } = await supabase
                .from("animation_submissions")
                .select("*")
                .eq(
                    "status",
                    "pending"
                )
                .order(
                    "created_at",
                    {
                        ascending: false,
                    }
                );


            if (error) {
                console.error(
                    "Submissions database error:",
                    error
                );

                return res
                    .status(500)
                    .json({
                        error:
                            error.message,
                    });
            }


            // ---------------------------------
            // LOAD JSON FILES FROM R2
            // ---------------------------------

            const submissions =
                await Promise.all(
                    data.map(
                        async (submission) => {

                            let animationJson = null;
                            let jsonError = null;


                            try {

                                if (
                                    !submission.storage_path
                                ) {
                                    throw new Error(
                                        "Submission has no storage_path"
                                    );
                                }


                                const objectUrl =
                                    `${R2_URL}/${BUCKET}/${submission.storage_path}`;


                                const fileResponse =
                                    await r2.fetch(
                                        objectUrl,
                                        {
                                            method: "GET",
                                        }
                                    );


                                if (!fileResponse.ok) {
                                    throw new Error(
                                        `R2 returned ${fileResponse.status}`
                                    );
                                }


                                const fileText =
                                    await fileResponse.text();


                                animationJson =
                                    JSON.parse(
                                        fileText
                                    );


                            } catch (error) {

                                console.error(
                                    `Failed to load JSON for submission ${submission.id}:`,
                                    error
                                );


                                jsonError =
                                    error.message;
                            }


                            // ---------------------------------
                            // PUBLIC DOWNLOAD URL
                            // ---------------------------------

                            let downloadUrl = null;


                            if (
                                submission.storage_path &&
                                R2_PUBLIC_URL
                            ) {
                                const encodedPath =
                                    submission
                                        .storage_path
                                        .split("/")
                                        .map(
                                            encodeURIComponent
                                        )
                                        .join("/");


                                downloadUrl =
                                    `${R2_PUBLIC_URL}/${encodedPath}`;
                            }


                            // ---------------------------------
                            // RETURN SUBMISSION
                            // ---------------------------------

                            return {
                                id:
                                    submission.id,

                                name:
                                    submission.name,

                                author:
                                    submission.author,

                                mail:
                                    submission.mail,

                                status:
                                    submission.status,

                                createdAt:
                                    submission.created_at,

                                storagePath:
                                    submission.storage_path,

                                downloadUrl,

                                json:
                                    animationJson,

                                jsonError,
                            };
                        }
                    )
                );


            console.log(
                `Pending submissions loaded: ${submissions.length}`
            );


            // ---------------------------------
            // RESPONSE
            // ---------------------------------

            return res.json({
                submissions,
                count:
                    submissions.length,
            });


        } catch (error) {

            console.error(
                "Submissions route error:",
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
// APPROVE SUBMISSION
// =====================================================

// =====================================================
// APPROVE SUBMISSION
// =====================================================

router.post(
    "/admin/submissions/:id/approve",
    requireAdmin,

    async (req, res) => {
        let newKey = null;
        let createdAnimationId = null;

        try {
            const submissionId =
                req.params.id;


            // ---------------------------------
            // GET SUBMISSION
            // ---------------------------------

            const {
                data: submission,
                error: submissionError,
            } = await supabase
                .from("animation_submissions")
                .select("*")
                .eq("id", submissionId)
                .maybeSingle();


            if (submissionError) {
                console.error(
                    "Submission load error:",
                    submissionError
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to load submission",
                    });
            }


            if (!submission) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Submission not found",
                    });
            }


            if (submission.status !== "pending") {
                return res
                    .status(400)
                    .json({
                        error:
                            `Submission is already ${submission.status}`,
                    });
            }


            if (!submission.storage_path) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Submission has no storage_path",
                    });
            }


            // ---------------------------------
            // SOURCE OBJECT
            // ---------------------------------

            const oldKey =
                submission.storage_path;

            const oldObjectUrl =
                `${R2_URL}/${BUCKET}/${oldKey}`;


            // ---------------------------------
            // DOWNLOAD FROM submissions/
            // ---------------------------------

            const sourceResponse =
                await r2.fetch(
                    oldObjectUrl,
                    {
                        method: "GET",
                    }
                );


            if (!sourceResponse.ok) {
                console.error(
                    "Failed to read submission file:",
                    sourceResponse.status
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to read submission file from R2",
                    });
            }


            const fileBuffer =
                await sourceResponse.arrayBuffer();


            // ---------------------------------
            // CREATE animations/ KEY
            // ---------------------------------

            const originalFileName =
                oldKey.split("/").pop();


            newKey =
                `animations/${originalFileName}`;


            const newObjectUrl =
                `${R2_URL}/${BUCKET}/${newKey}`;


            // ---------------------------------
            // UPLOAD TO animations/
            // ---------------------------------

            const uploadResponse =
                await r2.fetch(
                    newObjectUrl,
                    {
                        method: "PUT",

                        headers: {
                            "Content-Type":
                                "application/json",
                        },

                        body:
                            fileBuffer,
                    }
                );


            if (!uploadResponse.ok) {
                const responseText =
                    await uploadResponse.text();

                console.error(
                    "R2 animation copy failed:",
                    uploadResponse.status,
                    responseText
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to move animation to published storage",
                    });
            }


            // ---------------------------------
            // PUBLIC DOWNLOAD URL
            // ---------------------------------

            const encodedKey =
                newKey
                    .split("/")
                    .map(
                        encodeURIComponent
                    )
                    .join("/");


            const downloadUrl =
                `${R2_PUBLIC_URL}/${encodedKey}`;


            // ---------------------------------
            // CREATE PUBLISHED ANIMATION
            // ---------------------------------

            const {
                data: animation,
                error: publishError,
            } = await supabase
                .from("animations")
                .insert({
                    name:
                        submission.name,

                    author:
                        submission.author,

                    mail:
                        submission.mail,

                    download_url:
                        downloadUrl,
                })
                .select()
                .single();


            if (publishError) {
                console.error(
                    "Publish animation error:",
                    publishError
                );


                // rollback new R2 object
                try {
                    await r2.fetch(
                        newObjectUrl,
                        {
                            method: "DELETE",
                        }
                    );
                } catch (cleanupError) {
                    console.error(
                        "Failed to cleanup copied animation:",
                        cleanupError
                    );
                }


                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to publish animation",
                    });
            }


            createdAnimationId =
                animation.id;


            // ---------------------------------
            // UPDATE SUBMISSION
            // ---------------------------------

            const {
                error: updateError,
            } = await supabase
                .from("animation_submissions")
                .update({
                    status:
                        "approved",
                })
                .eq(
                    "id",
                    submissionId
                );


            if (updateError) {
                console.error(
                    "Submission status update failed:",
                    updateError
                );


                // rollback DB animation
                try {
                    await supabase
                        .from("animations")
                        .delete()
                        .eq(
                            "id",
                            createdAnimationId
                        );
                } catch (cleanupError) {
                    console.error(
                        "Animation DB rollback failed:",
                        cleanupError
                    );
                }


                // rollback new R2 file
                try {
                    await r2.fetch(
                        newObjectUrl,
                        {
                            method: "DELETE",
                        }
                    );
                } catch (cleanupError) {
                    console.error(
                        "R2 rollback failed:",
                        cleanupError
                    );
                }


                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to approve submission",
                    });
            }


            // ---------------------------------
            // DELETE OLD submissions/ FILE
            // ---------------------------------

            try {
                const deleteResponse =
                    await r2.fetch(
                        oldObjectUrl,
                        {
                            method: "DELETE",
                        }
                    );


                if (!deleteResponse.ok) {
                    console.warn(
                        "Old submission file could not be deleted:",
                        deleteResponse.status
                    );
                }

            } catch (deleteError) {

                /*
                    Это уже не критично.

                    Animation опубликована,
                    status обновлён.

                    Максимум останется
                    старый дубликат в submissions/.
                */

                console.warn(
                    "Old submission cleanup failed:",
                    deleteError
                );
            }


            // ---------------------------------
            // SUCCESS
            // ---------------------------------

            console.log(
                "Submission approved:",
                submissionId
            );

            console.log(
                "Moved:",
                oldKey,
                "->",
                newKey
            );


            return res.json({
                message:
                    "Submission approved successfully",

                animation,

                storage: {
                    oldPath:
                        oldKey,

                    newPath:
                        newKey,

                    downloadUrl,
                },
            });


        } catch (error) {

            console.error(
                "Approve submission error:",
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
// REJECT SUBMISSION
// =====================================================

router.post(
    "/admin/submissions/:id/reject",
    requireAdmin,

    async (req, res) => {
        try {
            const submissionId =
                req.params.id;


            // ---------------------------------
            // GET SUBMISSION
            // ---------------------------------

            const {
                data: submission,
                error: submissionError,
            } = await supabase
                .from("animation_submissions")
                .select(
                    "id, status"
                )
                .eq(
                    "id",
                    submissionId
                )
                .maybeSingle();


            if (submissionError) {
                console.error(
                    "Submission load error:",
                    submissionError
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to load submission",
                    });
            }


            if (!submission) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Submission not found",
                    });
            }


            if (submission.status !== "pending") {
                return res
                    .status(400)
                    .json({
                        error:
                            `Submission is already ${submission.status}`,
                    });
            }


            // ---------------------------------
            // REJECT
            // ---------------------------------

            const {
                error: rejectError,
            } = await supabase
                .from("animation_submissions")
                .update({
                    status: "rejected",
                })
                .eq(
                    "id",
                    submissionId
                );


            if (rejectError) {
                console.error(
                    "Reject submission error:",
                    rejectError
                );

                return res
                    .status(500)
                    .json({
                        error:
                            "Failed to reject submission",
                    });
            }


            console.log(
                "Submission rejected:",
                submissionId
            );


            return res.json({
                message:
                    "Submission rejected successfully",
            });

        } catch (error) {

            console.error(
                "Reject submission error:",
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


export default router;