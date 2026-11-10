"use strict";
// One-off helper: adds the CI npm scripts to package.json (keeps everything else). Run: node scripts/add-ci-scripts.js
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "package.json");
const raw = fs.readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const pkg = JSON.parse(raw);
const add = {
    build: "node scripts/build.js",
    "test:unit": "jest --runInBand --config ci/jest.unit.config.js",
    "test:integration": "jest --runInBand --config ci/jest.integration.config.js",
    "test:api": "jest --runInBand --config ci/jest.api.config.js",
    "db:migrate": "node scripts/migrate.js"
};
pkg.scripts = { ...(pkg.scripts || {}), ...add };
fs.writeFileSync(file, JSON.stringify(pkg, null, 2).replace(/\n/g, eol) + eol);
console.log("package.json scripts updated:", Object.keys(add).join(", "));

const ignoreFile = path.join(__dirname, "..", ".gitignore");
const ignore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
const missing = ["reports/", "dist/"].filter(line => !ignore.split(/\r?\n/).includes(line));
if (missing.length) {
    const sep = ignore && !ignore.endsWith("\n") ? eol : "";
    fs.writeFileSync(ignoreFile, ignore + sep + missing.join(eol) + eol);
    console.log(".gitignore updated:", missing.join(", "));
}
