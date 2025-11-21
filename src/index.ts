import express from "express";
import { env } from "./lib/env.ts";
import { initializeDatabase } from "./lib/db.ts";
import authRoutes from "./routes/auth.ts";

const PORT = env.PORT;
const app = express();

app.use(express.json());

// Initialize database
await initializeDatabase();

// Mount auth routes
app.use("/auth", authRoutes);

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
