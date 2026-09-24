import express from "express";
import cors from "cors";
import animationRouter from './animations.js';
import telemetryRouter from "./telemetry.js";
import sumbitssionsRouter from "./sumbitssions.js"

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
});

app.use("/", telemetryRouter);
app.use("/", animationRouter);
app.use("/", sumbitssionsRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});