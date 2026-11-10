"use strict";
// Integration tests = every *.test.js in tests/ except unit tests and API tests.
// Note: Jest does not expand <rootDir> in negated ("!") patterns, so they are written as plain globs.
module.exports = {
    ...require("./jest.base"),
    testMatch: ["<rootDir>/tests/**/*.test.js", "!**/tests/unit/**", "!**/tests/api.test.js"]
};
