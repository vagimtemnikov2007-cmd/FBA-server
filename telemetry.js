import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getToday() {
  return new Date().toISOString().slice(0, 10);
}


// =========================
// GET SITE STATS
// =========================

router.get("/stats", async (req, res) => {
  const { data, error } = await supabase
    .from("site_stats")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    console.error("Error fetching site stats:", error);

    return res.status(500).json({
      error: "Error fetching site stats",
    });
  }

  res.json(data);
});


// =========================
// VISITOR
// =========================

router.post("/visitors", async (req, res) => {
  const { visitorId } = req.body;

  if (!visitorId) {
    return res.status(400).json({
      error: "visitorId is required",
    });
  }

  const today = getToday();

  const { data, error } = await supabase
    .from("site_stats")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    console.error("Error fetching site stats:", error);

    return res.status(500).json({
      error: "Error fetching site stats",
    });
  }

  const isNewDay = data.current_day !== today;

  const dailyVisits = isNewDay
    ? 1
    : data.daily_visits + 1;

  const dailyDownloads = isNewDay
    ? 0
    : data.daily_downloads;

  const totalVisits = data.total_visits + 1;

  const { error: updateError } = await supabase
    .from("site_stats")
    .update({
      daily_visits: dailyVisits,
      total_visits: totalVisits,
      daily_downloads: dailyDownloads,
      current_day: today,
    })
    .eq("id", 1);

  if (updateError) {
    console.error("Error updating site stats:", updateError);

    return res.status(500).json({
      error: "Error updating site stats",
    });
  }

  console.log("visit:", visitorId);

  res.json({
    success: true,
    visitorId,
    date: today,
  });
});


// =========================
// DOWNLOAD
// =========================

router.post("/downloads", async (req, res) => {
  const { animationId } = req.body;

  if (!animationId) {
    return res.status(400).json({
      error: "animationId is required",
    });
  }

  const today = getToday();

  // Получаем глобальную статистику
  const { data: stats, error: statsError } = await supabase
    .from("site_stats")
    .select("*")
    .eq("id", 1)
    .single();

  if (statsError) {
    console.error("Error fetching site stats:", statsError);

    return res.status(500).json({
      error: "Error fetching site stats",
    });
  }

  // Получаем конкретную анимацию
  const { data: animation, error: animationError } = await supabase
    .from("animations")
    .select("id, download_count")
    .eq("id", animationId)
    .single();

  if (animationError) {
    console.error("Animation not found:", animationError);

    return res.status(404).json({
      error: "Animation not found",
    });
  }

  const isNewDay = stats.current_day !== today;

  const dailyDownloads = isNewDay
    ? 1
    : stats.daily_downloads + 1;

  const dailyVisits = isNewDay
    ? 0
    : stats.daily_visits;

  const totalDownloads = stats.total_downloads + 1;

  // Обновляем глобальную статистику
  const { error: statsUpdateError } = await supabase
    .from("site_stats")
    .update({
      daily_visits: dailyVisits,
      daily_downloads: dailyDownloads,
      total_downloads: totalDownloads,
      current_day: today,
    })
    .eq("id", 1);

  if (statsUpdateError) {
    console.error(
      "Error updating download stats:",
      statsUpdateError
    );

    return res.status(500).json({
      error: "Error updating download stats",
    });
  }

  // Обновляем счётчик конкретной анимации
  const newAnimationDownloadCount =
    (animation.download_count ?? 0) + 1;

  const { error: animationUpdateError } = await supabase
    .from("animations")
    .update({
      download_count: newAnimationDownloadCount,
    })
    .eq("id", animationId);

  if (animationUpdateError) {
    console.error(
      "Error updating animation download count:",
      animationUpdateError
    );

    return res.status(500).json({
      error: "Error updating animation download count",
    });
  }

  console.log(
    `download: animation ${animationId}, total ${totalDownloads}`
  );

  res.json({
    success: true,
    animationId,
    downloadCount: newAnimationDownloadCount,
    dailyDownloads,
    totalDownloads,
    date: today,
  });
});

export default router;