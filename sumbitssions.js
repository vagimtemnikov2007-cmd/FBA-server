import express from "express";
import multer from "multer";
import crypto from "crypto";

import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { createClient } from "@supabase/supabase-js";

const router = express.Router();


// ======================================================
// SUPABASE
// ======================================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ======================================================
// CLOUDFLARE R2
// ======================================================

const r2 = new S3Client({
    region: "auto",

    endpoint:
        `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

    credentials: {
        accessKeyId:
            process.env.R2_ACCESS_KEY_ID,

        secretAccessKey:
            process.env.R2_SECRET_ACCESS_KEY,
    },
});


const R2_BUCKET =
    process.env.R2_BUCKET_NAME || "fba";


// ======================================================
// MULTER
// ======================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        // JSON-анимации маленькие.
        // 2 MB здесь с огромным запасом.
        fileSize: 2 * 1024 * 1024,
    },

    fileFilter: (req, file, callback) => {
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


// ======================================================
// SUBMIT ANIMATION
// ======================================================

router.post(
    "/submitAnimation",

    upload.single("file"),

    async (req, res) => {

        let uploadedR2Key = null;

        try {

            const {
                name,
                author,
                mail,
            } = req.body;

            const file = req.file;


            // ==================================================
            // CHECK REQUIRED FIELDS
            // ==================================================

            if (
                !name?.trim() ||
                !author?.trim() ||
                !mail?.trim() ||
                !file
            ) {
                return res.status(400).json({
                    error:
                        "Missing required fields",
                });
            }


            // ==================================================
            // CHECK JSON
            // ==================================================

            let animationJson;

            try {

                animationJson = JSON.parse(
                    file.buffer.toString("utf-8")
                );

            } catch {

                return res.status(400).json({
                    error:
                        "Invalid JSON file",
                });

            }


            // ==================================================
            // OPTIONAL FBA VALIDATION
            // ==================================================

            if (
                typeof animationJson !== "object" ||
                animationJson === null
            ) {
                return res.status(400).json({
                    error:
                        "Animation JSON must contain an object",
                });
            }


            if (!animationJson.id) {
                return res.status(400).json({
                    error:
                        "Animation JSON is missing id",
                });
            }


            if (!animationJson.transform) {
                return res.status(400).json({
                    error:
                        "Animation JSON is missing transform",
                });
            }


            console.log(
                "Received animation:",
                animationJson.id
            );


            // ==================================================
            // CREATE SAFE FILE NAME
            // ==================================================

            const originalName =
                file.originalname.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );


            const uuid =
                crypto.randomUUID();


            const fileName =
                `${uuid}-${originalName}`;


            // В R2:
            //
            // fba/
            //   submissions/
            //     uuid-sidewinder.json

            const r2Key =
                `submissions/${fileName}`;


            uploadedR2Key =
                r2Key;


            // ==================================================
            // UPLOAD TO CLOUDFLARE R2
            // ==================================================

            const uploadCommand =
                new PutObjectCommand({

                    Bucket:
                        R2_BUCKET,

                    Key:
                        r2Key,

                    Body:
                        file.buffer,

                    ContentType:
                        "application/json",

                    Metadata: {
                        originalname:
                            originalName,

                        animationid:
                            String(animationJson.id),
                    },
                });


            await r2.send(
                uploadCommand
            );


            console.log(
                `Uploaded to R2: ${r2Key}`
            );


            // ==================================================
            // SAVE TO SUPABASE
            // ==================================================

            const {
                data,
                error: databaseError,
            } = await supabase
                .from(
                    "animation_submissions"
                )
                .insert({

                    name:
                        name.trim(),

                    author:
                        author.trim(),

                    mail:
                        mail.trim(),

                    storage_path:
                        r2Key,

                    status:
                        "pending",

                })
                .select()
                .single();


            // ==================================================
            // DATABASE FAILED
            // ==================================================

            if (databaseError) {

                console.error(
                    "Database error:",
                    databaseError
                );


                // JSON уже попал в R2,
                // но запись БД создать не удалось.
                //
                // Поэтому удаляем файл,
                // чтобы не оставлять мусор.

                try {

                    await r2.send(
                        new DeleteObjectCommand({

                            Bucket:
                                R2_BUCKET,

                            Key:
                                r2Key,

                        })
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


            // ==================================================
            // SUCCESS
            // ==================================================

            return res.status(201).json({

                message:
                    "Animation submitted successfully",

                submission: {

                    id:
                        data.id,

                    name:
                        data.name,

                    author:
                        data.author,

                    status:
                        data.status,

                    created_at:
                        data.created_at,

                },
            });


        } catch (error) {

            console.error(
                "Submit animation error:",
                error
            );


            // ==================================================
            // CLEAN R2 AFTER UNEXPECTED ERROR
            // ==================================================

            if (uploadedR2Key) {

                try {

                    await r2.send(
                        new DeleteObjectCommand({

                            Bucket:
                                R2_BUCKET,

                            Key:
                                uploadedR2Key,

                        })
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