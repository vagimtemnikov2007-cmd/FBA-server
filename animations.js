import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ВАЖНО: let, потому что кэш будет меняться
let animationCache = null;


async function fetchAnimationsFromDatabase() {
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
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}


router.get("/animations", async (req, res) => {
  try {

    if (animationCache !== null) {
      console.log("Animations served from cache");

      return res.json(animationCache);
    }


    console.log("Animations cache empty");

    const animations = await fetchAnimationsFromDatabase();
    animationCache = animations;

    return res.json(animationCache);

  } catch (error) {

    console.error("Error fetching animations:", error);

    return res.status(500).json({
      error: "Error fetching animations",
      details: error.message
    });
  }
});


router.post("/animations/cache/refresh", async (req, res) => {
  try {

    const cacheKey = req.headers["x-cache-key"];


    if (cacheKey !== process.env.CACHE_REFRESH_KEY) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }


    const animations = await fetchAnimationsFromDatabase();

    animationCache = animations;

    console.log("Animations cache refreshed");

 
    return res.json({
      success: true,
      animationsCount: animationCache.length
    });

  } catch (error) {

    console.error("Error refreshing animations cache:", error);

    return res.status(500).json({
      error: "Error refreshing animations cache",
      details: error.message
    });
  }
});


export default router;