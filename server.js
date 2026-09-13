import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.get('/stats', async (req, res) => {
  const { data, error } = await supabase
    .from('site_stats')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    console.error("Error fetching site stats:", error);
    return res.status(500).json({ error: "Error fetching site stats" });
  }

  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.post("/visitors", async (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) {
    return res.status(400).json({ error: "visitorId is required" });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('site_stats')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) {
    console.error("Error fetching site stats:", error);
    return res.status(500).json({ error: "Error fetching site stats" });
  }


  let dailyVisits = data.daily_visits
  let totalVisits = data.total_visits

  if (data.current_day !== today) {
    dailyVisits = 1;

  } else {
    dailyVisits += 1;
  }

  totalVisits += 1;

  const { error: updateError } = await supabase
    .from('site_stats')
    .update({
      daily_visits: dailyVisits,
      total_visits: totalVisits,
      current_day: today
    })
    .eq('id', 1);
    
  if (updateError) {
    console.error("Error updating site stats:", updateError);
    return res.status(500).json({ error: "Error updating site stats" });
  }

  console.log("visit:", visitorId);

  res.json({
    success: true,
    visitorId,
    date: today
  })
});