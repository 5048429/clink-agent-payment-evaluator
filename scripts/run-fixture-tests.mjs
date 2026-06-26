#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evaluator = path.join(repoRoot, "bin", "evaluate.mjs");
const profile = path.join(repoRoot, "examples", "generic-uat.profile.json");
const reportsDir = path.join(repoRoot, "reports");

const cases = [
  {
    id: "generic-pass",
    skill: path.join(repoRoot, "examples", "fixtures", "generic-pass"),
    expectedRecommendation: "certified",
    expectedNonPassIds: []
  },
  {
    id: "env-mismatch",
    skill: path.join(repoRoot, "examples", "fixtures", "env-mismatch"),
    expectedRecommendation: "not_certified",
    expectedNonPassIds: ["environment.consistency"]
  },
  {
    id: "missing-handoff",
    skill: path.join(repoRoot, "examples", "fixtures", "missing-handoff"),
    expectedRecommendation: "not_certified",
    expectedNonPassIds: ["handoff.contract"]
  }
];

fs.mkdirSync(reportsDir, { recursive: true });

let failures = 0;

for (const item of cases) {
  const out = path.join(reportsDir, `${item.id}.report.json`);
  const result = spawnSync(process.execPath, [evaluator, "--skill", item.skill, "--profile", profile, "--out", out], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });

  if (!fs.existsSync(out)) {
    failures += 1;
    console.error(`[FAIL] ${item.id}: report was not created`);
    console.error(result.stdout);
    console.error(result.stderr);
    continue;
  }

  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  const nonPassIds = (report.findings || [])
    .filter((finding) => finding.status !== "PASS")
    .map((finding) => finding.id);

  const recommendationOk = report.summary?.recommendation === item.expectedRecommendation;
  const idsOk = item.expectedNonPassIds.length === 0
    ? nonPassIds.length === 0
    : item.expectedNonPassIds.every((id) => nonPassIds.includes(id));

  if (recommendationOk && idsOk) {
    console.log(`[PASS] ${item.id}: ${report.summary.recommendation} (${report.summary.score.percentage}%)`);
    continue;
  }

  failures += 1;
  console.error(`[FAIL] ${item.id}`);
  console.error(`  expected recommendation: ${item.expectedRecommendation}`);
  console.error(`  actual recommendation: ${report.summary?.recommendation}`);
  console.error(`  expected non-pass ids: ${item.expectedNonPassIds.join(", ") || "(none)"}`);
  console.error(`  actual non-pass ids: ${nonPassIds.join(", ") || "(none)"}`);
}

if (failures > 0) {
  process.exit(1);
}
