import express from "express";
import multer from "multer";
import crypto from "crypto";
import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim();
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim();
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim();
const BUCKET = process.env.R2_BUCKET_NAME?.trim() || "fba";

if (!ACCOUNT_ID) {
    throw new Error("Missing R2_ACCOUNT_ID");
}

if (!ACCESS_KEY_ID) {
    throw new Error("Missing R2_ACCESS_KEY_ID");
}

if (!SECRET_ACCESS_KEY) {
    throw new Error("Missing R2_SECRET_ACCESS_KEY");
}

const R2_URL =
    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const r2 = new AwsClient({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
});


const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 2 * 1024 * 1024,
    },

    fileFilter: (req, file, callback) => {
        const fileName = file.originalname.toLowerCase();

        if (!fileName.endsWith(".json")) {
            return callback(
                new Error("Only .json files are allowed")
            );
        }

        callback(null, true);
    },
});


router.post(
    "/submitAnimation",
    upload.single("file"),

    async (req, res) => {
        let uploadedKey = null;

        try {
            const {
                name,
                author,
                mail,
            } = req.body;

            const file = req.file;

            // -------------------------------
            // BASIC VALIDATION
            // -------------------------------

            if (
                !name?.trim() ||
                !author?.trim() ||
                !mail?.trim() ||
                !file
            ) {
                return res.status(400).json({
                    error: "Missing required fields",
                });
            }


            // -------------------------------
            // JSON VALIDATION
            // -------------------------------

            let animationJson;

            try {
                animationJson = JSON.parse(
                    file.buffer.toString("utf-8")
                );
            } catch {
                return res.status(400).json({
                    error: "Invalid JSON file",
                });
            }


            if (
                typeof animationJson !== "object" ||
                animationJson === null
            ) {
                return res.status(400).json({
                    error: "Invalid animation JSON",
                });
            }


            if (!animationJson.id) {
                return res.status(400).json({
                    error: "Animation JSON is missing id",
                });
            }


            if (!animationJson.transform) {
                return res.status(400).json({
                    error: "Animation JSON is missing transform",
                });
            }


            console.log(
                "Received animation:",
                animationJson.id
            );


            // -------------------------------
            // CREATE OBJECT KEY
            // -------------------------------

            const safeName =
                file.originalname.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );

            const fileName =
                `${crypto.randomUUID()}-${safeName}`;

            const key =
                `submissions/${fileName}`;

            uploadedKey = key;


            // -------------------------------
            // R2 UPLOAD
            // -------------------------------

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

                        body: file.buffer,
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

                return res.status(500).json({
                    error:
                        `R2 upload failed (${uploadResponse.status})`,
                });
            }


            console.log(
                "R2 upload success:",
                key
            );


            // -------------------------------
            // SAVE TO SUPABASE
            // -------------------------------

            const {
                data,
                error: databaseError,
            } = await supabase
                .from("animation_submissions")
                .insert({
                    name: name.trim(),
                    author: author.trim(),
                    mail: mail.trim(),

                    storage_path: key,

                    status: "pending",
                })
                .select()
                .single();


            // -------------------------------
            // DATABASE FAILED
            // -------------------------------

            if (databaseError) {
                console.error(
                    "Database error:",
                    databaseError
                );


                try {
                    const deleteUrl =
                        `${R2_URL}/${BUCKET}/${key}`;

                    await r2.fetch(
                        deleteUrl,
                        {
                            method: "DELETE",
                        }
                    );

                } catch (cleanupError) {
                    console.error(
                        "R2 cleanup error:",
                        cleanupError
                    );
                }


                return res.status(500).json({
                    error:
                        "Failed to save submission",
                });
            }


            // -------------------------------
            // SUCCESS
            // -------------------------------

            return res.status(201).json({
                message:
                    "Animation submitted successfully",

                submission: {
                    id: data.id,
                    name: data.name,
                    author: data.author,
                    status: data.status,
                    created_at: data.created_at,
                },
            });

        } catch (error) {
            console.error(
                "Submit animation error:",
                error
            );


            if (uploadedKey) {
                try {
                    const deleteUrl =
                        `${R2_URL}/${BUCKET}/${uploadedKey}`;

                    await r2.fetch(
                        deleteUrl,
                        {
                            method: "DELETE",
                        }
                    );

                } catch (cleanupError) {
                    console.error(
                        "R2 cleanup error:",
                        cleanupError
                    );
                }
            }


            return res.status(500).json({
                error:
                    error.message ||
                    "Internal server error",
            });
        }
    }
);


export default router;