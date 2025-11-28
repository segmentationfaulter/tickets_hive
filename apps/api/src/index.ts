import express from "express";
import { env } from "@ticket-hive/lib";
import { initializeDatabase } from "@ticket-hive/database";
import authRoutes from "./routes/auth.ts";
import eventRoutes from "./routes/events.ts";
import bookingRoutes from "./routes/bookings.ts";

const PORT = env.PORT;
const app = express();

app.use(express.json());

// Initialize database
try {
  await initializeDatabase();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("❌ Failed to initialize database:", errorMessage);
  console.error(
    "💡 The application will exit - please check database configuration",
  );
  process.exit(1);
}

// Mount routes
app.use("/auth", authRoutes);
app.use("/api/v1/events", eventRoutes);
app.use("/api/v1/bookings", bookingRoutes);

const server = app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});

// Graceful shutdown on SIGTERM (Docker/K8s) and SIGINT (Ctrl+C)
async function shutdown() {
  console.log("🛑 Shutting down API server gracefully...");

  server.close(() => {
    console.log("✅ HTTP server closed");
  });

  // Give in-flight requests 5 seconds to complete
  setTimeout(() => {
    console.error("⚠️  Forcing shutdown after timeout");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
