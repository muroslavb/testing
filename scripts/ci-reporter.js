"use strict";
/**
 * Jest reporter for CI (no dependencies). Active when CI or REPORT_NAME is set.
 * Writes reports/junit-<name>.xml (JUnit XML) and reports/summary-<name>.json,
 * and appends a Markdown table to the GitHub job summary ($GITHUB_STEP_SUMMARY).
 */
const fs = require("node:fs");
const path = require("node:path");

const stripAnsi = s => String(s).replace(/\u001b\[[0-9;]*m/g, "");
const xml = s => stripAnsi(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" }[c]));
const seconds = ms => ((ms || 0) / 1000).toFixed(3);

class CiReporter {
    constructor(globalConfig) { this.rootDir = globalConfig.rootDir; }

    onRunComplete(_contexts, results) {
        if (!process.env.CI && !process.env.REPORT_NAME) return;
        const name = process.env.REPORT_NAME || "tests";
        const dir = path.join(this.rootDir, "reports");
        fs.mkdirSync(dir, { recursive: true });

        const suites = [];
        const failedList = [];
        const totals = { tests: 0, failed: 0, skipped: 0, passed: 0 };

        for (const file of results.testResults) {
            const suiteName = path.relative(this.rootDir, file.testFilePath).split(path.sep).join("/");
            const cases = file.testResults.map(t => ({
                name: t.fullName || t.title,
                time: t.duration || 0,
                status: t.status === "passed" ? "passed" : t.status === "failed" ? "failed" : "skipped",
                message: (t.failureMessages || []).join("\n")
            }));
            // The file could not run at all (syntax error, DB unavailable in beforeAll, ...).
            if (!cases.some(c => c.status === "failed") && (file.testExecError || (file.numFailingTests === 0 && file.failureMessage))) {
                cases.push({
                    name: "Test suite failed to run", time: 0, status: "failed",
                    message: file.failureMessage || String(file.testExecError && file.testExecError.message)
                });
            }
            const suiteTime = file.perfStats ? file.perfStats.end - file.perfStats.start : 0;
            suites.push({ suiteName, cases, time: suiteTime, start: file.perfStats ? file.perfStats.start : Date.now() });
            for (const c of cases) {
                totals.tests++;
                totals[c.status === "passed" ? "passed" : c.status]++;
                if (c.status === "failed") failedList.push({ suite: suiteName, name: c.name, message: stripAnsi(c.message) });
            }
        }

        const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
            `<testsuites name="${xml(name)}" tests="${totals.tests}" failures="${totals.failed}" skipped="${totals.skipped}" time="${seconds(Date.now() - results.startTime)}">`];
        for (const s of suites) {
            const failures = s.cases.filter(c => c.status === "failed").length;
            const skipped = s.cases.filter(c => c.status === "skipped").length;
            lines.push(`  <testsuite name="${xml(s.suiteName)}" tests="${s.cases.length}" failures="${failures}" skipped="${skipped}" time="${seconds(s.time)}" timestamp="${new Date(s.start).toISOString()}">`);
            for (const c of s.cases) {
                const open = `    <testcase classname="${xml(s.suiteName)}" name="${xml(c.name)}" time="${seconds(c.time)}"`;
                if (c.status === "passed") lines.push(open + "/>");
                else if (c.status === "skipped") lines.push(open + "><skipped/></testcase>");
                else lines.push(`${open}><failure message="${xml(stripAnsi(c.message).split("\n")[0])}">${xml(c.message)}</failure></testcase>`);
            }
            lines.push("  </testsuite>");
        }
        lines.push("</testsuites>");
        fs.writeFileSync(path.join(dir, `junit-${name}.xml`), lines.join("\n") + "\n");
        fs.writeFileSync(path.join(dir, `summary-${name}.json`), JSON.stringify({ name, ...totals, failedTests: failedList }, null, 2));

        if (process.env.GITHUB_STEP_SUMMARY) {
            const ok = totals.failed === 0;
            const md = [
                `## ${ok ? "✅" : "❌"} ${name}: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped (${totals.tests} total)`,
                "", "| Suite | Passed | Failed | Skipped |", "|---|---|---|---|",
                ...suites.map(s => {
                    const f = s.cases.filter(c => c.status === "failed").length;
                    const k = s.cases.filter(c => c.status === "skipped").length;
                    return `| ${s.suiteName} | ${s.cases.length - f - k} | ${f} | ${k} |`;
                }), ""];
            if (failedList.length) {
                md.push("### Failed tests", "");
                for (const f of failedList) {
                    md.push(`<details><summary>${f.suite}: ${f.name.replace(/[<>&]/g, "")}</summary>`, "", "```", f.message.slice(0, 1500), "```", "", "</details>", "");
                }
            }
            fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
        }
    }
}
module.exports = CiReporter;
