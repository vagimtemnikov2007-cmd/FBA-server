import express from "express";
import multer from "multer";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 20 * 1024 * 1024,
    },

    fileFilter: (req, file, callback) => {
        const fileName = file.originalname.toLowerCase();

        const allowed =
            fileName.endsWith(".fba") ||
            fileName.endsWith(".zip");

        if (!allowed) {
            return callback(
                new Error(
                    "Only .fba and .zip files are allowed"
                )
            );
        }

        callback(null, true);
    },
});


router.post(
    "/submitAnimation",
    upload.single("file"),

    async (req, res) => {
        let uploadedStoragePath = null;

        try {
            const {
                name,
                author,
                mail,
            } = req.body;

            const file = req.file;

            // ---------------------------
            // VALIDATION
            // ---------------------------

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

            // ---------------------------
            // UNIQUE FILE NAME
            // ---------------------------

            const originalName =
                file.originalname.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );

            const fileName =
                `${crypto.randomUUID()}-${originalName}`;

            const storagePath =
                `submissions/${fileName}`;

            uploadedStoragePath = storagePath;

            // ---------------------------
            // UPLOAD TO PRIVATE STORAGE
            // ---------------------------

            const {
                error: storageError,
            } = await supabase.storage
                .from("animation-submissions")
                .upload(
                    storagePath,
                    file.buffer,
                    {
                        contentType:
                            file.mimetype ||
                            "application/octet-stream",

                        upsert: false,
                    }
                );

            if (storageError) {
                console.error(
                    "Storage upload error:",
                    storageError
                );

                return res.status(500).json({
                    error: "Failed to upload file",
                });
            }

            // ---------------------------
            // SAVE SUBMISSION TO DATABASE
            // ---------------------------

            const {
                data,
                error: databaseError,
            } = await supabase
                .from("animation_submissions")
                .insert({
                    name: name.trim(),
                    author: author.trim(),
                    mail: mail.trim(),

                    storage_path: storagePath,

                    status: "pending",
                })
                .select()
                .single();

            if (databaseError) {
                console.error(
                    "Database error:",
                    databaseError
                );

                // Если БД сломалась —
                // удаляем уже загруженный файл,
                // чтобы он не висел мусором.

                await supabase.storage
                    .from("animation-submissions")
                    .remove([storagePath]);

                return res.status(500).json({
                    error:
                        "Failed to save submission",
                });
            }

            // ---------------------------
            // SUCCESS
            // ---------------------------

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

            // На случай неожиданной ошибки
            // после загрузки файла.

            if (uploadedStoragePath) {
                try {
                    await supabase.storage
                        .from(
                            "animation-submissions"
                        )
                        .remove([
                            uploadedStoragePath,
                        ]);
                } catch (cleanupError) {
                    console.error(
                        "Cleanup error:",
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