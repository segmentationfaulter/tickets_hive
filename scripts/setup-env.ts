#!/usr/bin/env node
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const secretsDir = join(projectRoot, "secrets");

try {
  // Create secrets directory if it doesn't exist
  if (!existsSync(secretsDir)) {
    mkdirSync(secretsDir, { recursive: true });
    console.log("✅ Created secrets/ directory");
  }

  // Generate database password if it doesn't exist
  const dbPasswordFile = join(secretsDir, "db_password.txt");
  if (!existsSync(dbPasswordFile)) {
    const dbPassword = randomBytes(32).toString("hex");
    writeFileSync(dbPasswordFile, dbPassword, { mode: 0o600 }); // Read/write for owner only
    console.log("✅ Generated secure database password");
  } else {
    console.log("ℹ️  Database password already exists, skipping");
  }

  // Generate JWT secret if it doesn't exist
  const jwtSecretFile = join(secretsDir, "jwt_secret.txt");
  if (!existsSync(jwtSecretFile)) {
    const jwtSecret = randomBytes(64).toString("hex");
    writeFileSync(jwtSecretFile, jwtSecret, { mode: 0o600 }); // Read/write for owner only
    console.log("✅ Generated secure JWT secret");
  } else {
    console.log("ℹ️  JWT secret already exists, skipping");
  }

  console.log("\n🎉 Environment setup complete!");
  console.log("You can now run:");
  console.log("  npm run docker:dev  # For Docker development");
  console.log("  npm run dev         # For local development");
} catch (error) {
  console.error("❌ Error setting up environment:", error.message);
  process.exit(1);
}
