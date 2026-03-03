import express from "express";
import { createRequestHandler } from "@remix-run/express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("build/client"));

const build = await import("./build/server/index.js");
app.all("*", createRequestHandler({ build }));

app.listen(PORT, () => {
  console.log(`FulfillHub Remix app running on port ${PORT}`);
});
