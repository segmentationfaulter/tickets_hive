import express from "express";
import { env } from "./env.ts";

const PORT = env.PORT;
const app = express();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
