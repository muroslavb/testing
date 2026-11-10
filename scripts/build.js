"use strict";
/**
 * "Build" for a plain Node.js project: there is nothing to compile, so the build step
 *   1) checks syntax of every .js file in src/ and scripts/ (node --check),
 *   2) loads every module in src/ (broken require / missing export fails here),
 *   3) assembles dist/ (src, migrations, package files) - the build artifact.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const listJs = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listJs(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
let errors = 0;

console.log("[1/3] syntax check");
for (const file of [...listJs(path.join(root, "src")), ...listJs(path.join(root, "scripts"))]) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) { errors++; console.error(`  FAIL ${path.relative(root, file)}\n${result.stderr}`); }
    else console.log(`  ok   ${path.relative(root, file)}`);
}

console.log("[2/3] module graph");
for (const file of listJs(path.join(root, "src"))) {
    try { require(file); console.log(`  ok   ${path.relative(root, file)}`); }
    catch (error) { errors++; console.error(`  FAIL ${path.relative(root, file)}: ${error.message}`); }
}
try {
    if (typeof require(path.join(root, "src", "api.js")).createApp !== "function") throw new Error("api.js does not export createApp()");
} catch (error) { errors++; console.error(`  FAIL api contract: ${error.message}`); }

if (errors) { console.error(`\nBuild FAILED: ${errors} problem(s)`); process.exit(1); }

console.log("[3/3] dist/");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, "src"), path.join(dist, "src"), { recursive: true });
fs.cpSync(path.join(root, "migrations"), path.join(dist, "migrations"), { recursive: true });
for (const f of ["package.json", "package-lock.json", "README.md"]) {
    if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(dist, f));
}
fs.writeFileSync(path.join(dist, "BUILD_INFO.json"), JSON.stringify({
    commit: process.env.GITHUB_SHA || "local", node: process.version, builtAt: new Date().toISOString()
}, null, 2));
console.log("\nBuild OK -> dist/");
