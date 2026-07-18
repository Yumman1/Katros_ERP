#!/usr/bin/env node
/**
 * Copies Kastros brand PNGs into public/branding for the Next.js app.
 * Run after clone if logos are missing: node scripts/copy-brand-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dst = path.join(root, "public", "branding");

const candidates = [
  path.join(root, "assets", "branding"),
  path.join(
    root,
    "..",
    ".cursor",
    "projects",
    "c-Users-HP-Desktop-Kastros-Supply-Chain",
    "assets",
  ),
];

const mapping = [
  ["favicon.png", "favicon.png"],
  ["logo.png", "logo.png"],
  ["logo-white.png", "logo-white.png"],
  [
    "c__Users_HP_AppData_Roaming_Cursor_User_workspaceStorage_0cd89ea911097da0d5506250eea5a554_images_Kastros-8-15-2742_Favicon_Square_Orignal-03dcd6b6-cb18-4127-bb0b-006ac5603b1f.png",
    "favicon.png",
  ],
  [
    "c__Users_HP_AppData_Roaming_Cursor_User_workspaceStorage_0cd89ea911097da0d5506250eea5a554_images_Kastros-8-15-2742_Logo_Orignal-8aeaa77a-5791-4ef1-bb8d-76fa459b6dcf.png",
    "logo.png",
  ],
  [
    "c__Users_HP_AppData_Roaming_Cursor_User_workspaceStorage_0cd89ea911097da0d5506250eea5a554_images_Kastros_-_White_text_for_dark_backgroud-ae099b02-18f6-40b6-a5a4-a76575dab6f9.png",
    "logo-white.png",
  ],
];

fs.mkdirSync(dst, { recursive: true });

let copied = 0;
for (const dir of candidates) {
  if (!fs.existsSync(dir)) continue;
  for (const [srcName, outName] of mapping) {
    const src = path.join(dir, srcName);
    const out = path.join(dst, outName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, out);
      copied++;
    }
  }
}

const required = ["favicon.png", "logo.png", "logo-white.png"];
const missing = required.filter((f) => !fs.existsSync(path.join(dst, f)));
if (missing.length) {
  console.error("Missing brand files:", missing.join(", "));
  console.error("Place PNGs in assets/branding/ and re-run.");
  process.exit(1);
}

console.log(`Brand assets OK in public/branding (${copied} file(s) copied).`);
