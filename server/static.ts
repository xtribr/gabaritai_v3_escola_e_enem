import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  // Em modo API-only (produção Fly.io), não precisa servir frontend
  // O frontend está no Vercel
  if (!fs.existsSync(distPath)) {
    console.log(
      `[static] Build directory not found: ${distPath}. Running in API-only mode (frontend served from Vercel).`,
    );
    return;
  }

  console.log(`[static] Serving static files from: ${distPath}`);
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
