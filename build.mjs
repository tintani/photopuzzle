import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const deployFiles = ["index.html", "styles.css", "puzzle.js"];

if (path.dirname(output) !== root || path.basename(output) !== "dist") {
  throw new Error("Unexpected build output path.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of deployFiles) {
  await cp(path.join(root, file), path.join(output, file));
}
console.log(`Static site ready: ${output}`);
