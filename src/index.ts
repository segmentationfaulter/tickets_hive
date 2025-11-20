import express from "express";
import { env } from "./lib/env.ts";
import sql from "./lib/db.ts";

const PORT = env.PORT;
const app = express();

app.get("/", async (req, res) => {
  try {
    await sql`SELECT 1`;
    console.log("DB connection success");
  } catch (err) {
    console.error("DB conn failed", err);
  }
  res.send("Hello World!");
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
