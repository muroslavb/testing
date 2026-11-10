"use strict";
// Applies migrations/V*__*.sql in name order to the database from DB_* variables (used by CI and locally).
const fs = require("node:fs");
const path = require("node:path");
const { connect } = require("../src/database");

(async () => {
    const dir = path.join(__dirname, "..", "migrations");
    const files = fs.readdirSync(dir).filter(name => /^V.*__.*[.]sql$/.test(name)).sort();
    const client = await connect();
    try {
        for (const file of files) {
            await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
            console.log(`applied ${file}`);
        }
    } finally { await client.end(); }
})().catch(error => { console.error("Migration failed:", error.message); process.exit(1); });
