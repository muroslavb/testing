"use strict";
// Demo helper for the "failed pipeline" scenario: injects / removes a deliberate bug in src/service.js
// (discount 17% -> 18%). Usage: node scripts/demo-failure.js on | off
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "service.js");
const source = fs.readFileSync(file, "utf8");
const mode = process.argv[2];
const good = "subtotal >= 100000 ? 17 : 0";
const bad = "subtotal >= 100000 ? 18 : 0";
if (mode === "on" && source.includes(good)) fs.writeFileSync(file, source.replace(good, bad));
else if (mode === "off" && source.includes(bad)) fs.writeFileSync(file, source.replace(bad, good));
else if (mode !== "on" && mode !== "off") { console.error("Usage: node scripts/demo-failure.js on | off"); process.exit(2); }
else { console.log(`Nothing to do (already ${mode}).`); process.exit(0); }
console.log(mode === "on" ? "Deliberate bug INJECTED (discount 18%). Commit and push to see a failed pipeline." : "Bug REMOVED (discount 17%).");
