import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.post("/api/telemetry/visitors", async (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) {
    return res.status(400).json({ error: "visitorId is required" });
  }

  console.log("visit:", visitorId);
  res.json({
    success: true,
    visitorId,
  })
});