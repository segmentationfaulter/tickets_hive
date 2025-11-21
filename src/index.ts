import express from "express";
import { env } from "./lib/env.ts";
import { initializeDatabase } from "./lib/db.ts";
import authRoutes from "./routes/auth.ts";
import eventRoutes from "./routes/events.ts";

const PORT = env.PORT;
const app = express();

app.use(express.json());

// Initialize database
await initializeDatabase();

// Mount routes
app.use("/auth", authRoutes);
app.use("/api/v1/events", eventRoutes);

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
