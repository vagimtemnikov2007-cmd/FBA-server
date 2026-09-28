import express from "express";
import cors from "cors";
import animationRouter from './animations.js';
import telemetryRouter from "./telemetry.js";
import sumbitssionsRouter from "./sumbitssions.js"
import adminRouter from "./routes/admin.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
});

app.use("/", telemetryRouter);
app.use("/", animationRouter);
app.use("/", sumbitssionsRouter);

app.use(express.json());

app.use(adminRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});