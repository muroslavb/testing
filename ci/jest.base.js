"use strict";
const path = require("node:path");

// Shared Jest settings for CI runs: console output + JUnit XML / job summary via scripts/ci-reporter.js.
module.exports = {
    rootDir: path.join(__dirname, ".."),
    testEnvironment: "node",
    reporters: ["default", path.join(__dirname, "..", "scripts", "ci-reporter.js")]
};
