#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { spawnSync } from "node:child_process";

const CHECKS = [
  { id: "package.structure", points: 10 },
  { id: "security.no_secrets", points: 15 },
  { id: "merchant.config", points: 15 },
  { id: "payment.runtime_dependency", points: 10 },
  { id: "wallet.readiness", points: 10 },
  { id: "authorization.exact_charge", points: 10 },
  { id: "handoff.contract", points: 15 },
  { id: "merchant.confirmation", points: 15 },
  { id: "failure.semantics", points: 15 },
  { id: "environment.consistency", points: 15 }
];

const SECRET_PATTERNS = [
  { name: "clink customer api key", pattern: /csk_(prod|uat|test)_[A-Za-z0-9]{20,}/g },
  { name: "clink secret key", pattern: /CLINK_SECRET_KEY\s*=\s*["'][^"']+["']/g },
  { name: "clink webhook signing key", pattern: /CLINK_WEBHOOK_SIGNING_KEY\s*=\s*["'][^"']+["']/g },
  { name: "openai-style secret", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "jwt bearer token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g }
];

function parseArgs(argv) {
  const args = { mode: "static", allowCharge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--skill") args.skill = argv[++i];
    else if (item === "--profile" || item === "--manifest") args.profile = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--mode") args.mode = argv[++i];
    else if (item === "--allow-charge") args.allowCharge = true;
    else if (item === "--keep-temp") args.keepTemp = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node bin/evaluate.mjs --skill <skill.zip|dir> [--profile profile.json] [--out report.json]",
    "  node bin/evaluate.mjs --mode clink-live --allow-charge --skill <skill.zip|dir> --profile profile.json",
    "",
    "Modes:",
    "  static      Static package and contract evaluation. No charge. Default.",
    "  clink-live  Run Clink UAT live payment checks. Requires --allow-charge."
  ].join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function escapePowerShellLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function extractZip(zipPath) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "clink-agent-payment-eval-"));
  if (process.platform === "win32") {
    const script = `Expand-Archive -LiteralPath '${escapePowerShellLiteral(zipPath)}' -DestinationPath '${escapePowerShellLiteral(dest)}' -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Expand-Archive failed: ${result.stderr || result.stdout}`);
  } else {
    const result = spawnSync("unzip", ["-q", zipPath, "-d", dest], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
  return dest;
}

function findSkillRoot(inputPath) {
  const stat = fs.statSync(inputPath);
  let root = inputPath;
  let tempDir = null;
  if (stat.isFile() && inputPath.toLowerCase().endsWith(".zip")) {
    tempDir = extractZip(inputPath);
    root = tempDir;
  }
  const candidates = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    if (fs.existsSync(path.join(dir, "SKILL.md"))) candidates.push(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) walk(path.join(dir, entry.name), depth + 1);
    }
  }
  walk(root, 0);
  return { root: candidates[0] || root, tempDir };
}

function listFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "__MACOSX"].includes(entry.name)) walk(full);
      } else {
        files.push(full);
      }
    }
  }
  walk(root);
  return files;
}

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  return [".md", ".txt", ".json", ".yaml", ".yml", ".js", ".mjs", ".ts", ".sh", ".cmd", ".html"].includes(ext) || path.basename(file) === "SKILL.md";
}

function loadTexts(root) {
  const files = listFiles(root);
  const texts = [];
  for (const file of files) {
    if (!isTextFile(file)) continue;
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    texts.push({ rel, file, content });
  }
  return { files, texts, corpus: texts.map((item) => `\n--- ${item.rel} ---\n${item.content}`).join("\n") };
}

function urlsIn(text) {
  return [...text.matchAll(/https?:\/\/[^\s)"'<>]+/g)].map((match) => match[0].replace(/[),.;]+$/, ""));
}

function merchantIdsIn(text) {
  return [...new Set([...text.matchAll(/\bmcht_[a-z0-9]+\b/g)].map((match) => match[0]))];
}

function firstEvidence(texts, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const { rel, content } of texts) {
    for (const pattern of list) {
      const ok = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern);
      if (ok) return rel;
    }
  }
  return null;
}

function statusFor(findings, id) {
  return findings.find((finding) => finding.id === id)?.status || "PASS";
}

function addFinding(findings, finding) {
  findings.push({
    id: finding.id,
    status: finding.status,
    severity: finding.severity || (finding.status === "PASS" ? "info" : "warn"),
    capability: finding.capability,
    title: finding.title,
    evidence: finding.evidence || [],
    recommendation: finding.recommendation || ""
  });
}

function score(findings) {
  let earned = 0;
  let possible = 0;
  for (const check of CHECKS) {
    possible += check.points;
    const status = statusFor(findings, check.id);
    if (status === "PASS") earned += check.points;
    else if (status === "WARN") earned += Math.round(check.points * 0.5);
  }
  return { earned, possible, percentage: possible ? Math.round((earned / possible) * 100) : 0 };
}

function recommendation(findings, scoreResult) {
  const hasBlocker = findings.some((item) => item.status === "BLOCKED" || item.severity === "blocker");
  const hasFail = findings.some((item) => item.status === "FAIL");
  if (!hasBlocker && !hasFail && scoreResult.percentage >= 90) return "certified";
  if (!hasBlocker && scoreResult.percentage >= 70) return "conditional";
  return "not_certified";
}

function parseContracts(root, texts) {
  const candidates = texts.filter((item) => /agent-payment.*contract.*\.json$/i.test(item.rel) || /contracts\/.*\.json$/i.test(item.rel));
  const parsed = [];
  for (const candidate of candidates) {
    try {
      parsed.push({ rel: candidate.rel, json: JSON.parse(candidate.content) });
    } catch (error) {
      parsed.push({ rel: candidate.rel, error: error.message });
    }
  }
  return parsed;
}

function parsePaymentConfig(texts) {
  const configFile = texts.find((item) => /get_payment_config\.sh$/i.test(item.rel) || /payment.*config/i.test(item.rel));
  if (!configFile) return null;
  const merchantId = configFile.content.match(/"merchant_id"\s*:\s*"([^"]+)"/)?.[1] || configFile.content.match(/merchant[_-]?id["'\s:=]+(mcht_[a-z0-9]+)/i)?.[1] || null;
  const amountRaw = configFile.content.match(/"default_amount"\s*:\s*([0-9.]+)/)?.[1] || configFile.content.match(/"amount"\s*:\s*([0-9.]+)/)?.[1] || null;
  const currency = configFile.content.match(/"currency"\s*:\s*"([A-Z]{3})"/)?.[1] || null;
  return { rel: configFile.rel, merchantId, amount: amountRaw ? Number(amountRaw) : null, currency };
}

function evaluateStatic({ root, profile }) {
  const { files, texts, corpus } = loadTexts(root);
  const findings = [];
  const contracts = parseContracts(root, texts);
  const paymentConfig = parsePaymentConfig(texts);
  const merchantIds = merchantIdsIn(corpus);
  const allUrls = [...new Set(urlsIn(corpus))];

  if (fs.existsSync(path.join(root, "SKILL.md"))) {
    addFinding(findings, {
      id: "package.structure",
      status: "PASS",
      capability: "Uploaded skill package can be inspected.",
      title: "SKILL.md found",
      evidence: ["SKILL.md"]
    });
  } else {
    addFinding(findings, {
      id: "package.structure",
      status: "FAIL",
      severity: "blocker",
      capability: "Uploaded skill package can be inspected.",
      title: "Missing SKILL.md",
      recommendation: "Add SKILL.md at the skill root."
    });
  }

  const secretHits = [];
  for (const { rel, content } of texts) {
    for (const secret of SECRET_PATTERNS) {
      if (secret.pattern.test(content)) secretHits.push(`${rel}: ${secret.name}`);
      secret.pattern.lastIndex = 0;
    }
  }
  addFinding(findings, secretHits.length ? {
    id: "security.no_secrets",
    status: "FAIL",
    severity: "blocker",
    capability: "Package is safe for upload and review.",
    title: "Potential secrets found",
    evidence: secretHits.slice(0, 10),
    recommendation: "Remove committed secrets; use runtime environment variables or secret manager references."
  } : {
    id: "security.no_secrets",
    status: "PASS",
    capability: "Package is safe for upload and review.",
    title: "No obvious committed secrets found"
  });

  const expected = profile?.expected || {};
  const expectedMerchant = expected.merchantId;
  const configEvidence = [];
  if (paymentConfig) configEvidence.push(`${paymentConfig.rel}: ${JSON.stringify(paymentConfig)}`);
  if (merchantIds.length) configEvidence.push(`merchant ids: ${merchantIds.join(", ")}`);
  let merchantStatus = "PASS";
  let merchantTitle = "Merchant payment target is declared";
  let merchantSeverity = "info";
  let merchantRecommendation = "";
  if (!paymentConfig && merchantIds.length === 0) {
    merchantStatus = "FAIL";
    merchantSeverity = "blocker";
    merchantTitle = "No merchant payment target found";
    merchantRecommendation = "Declare merchant id, default amount, and currency through a standard payment config tool or contract.";
  } else if (expectedMerchant && !merchantIds.includes(expectedMerchant) && paymentConfig?.merchantId !== expectedMerchant) {
    merchantStatus = "FAIL";
    merchantSeverity = "blocker";
    merchantTitle = "Merchant id does not match evaluation profile";
    merchantRecommendation = `Use expected merchant id ${expectedMerchant}.`;
  } else if (merchantIds.length > 1) {
    merchantStatus = "WARN";
    merchantSeverity = "warn";
    merchantTitle = "Multiple merchant ids found";
    merchantRecommendation = "Use a single runtime-resolved merchant id or document environment-specific ids clearly.";
  } else if (expected.amount !== undefined && paymentConfig?.amount !== null && Number(expected.amount) !== Number(paymentConfig.amount)) {
    merchantStatus = "FAIL";
    merchantSeverity = "blocker";
    merchantTitle = "Default amount does not match evaluation profile";
    merchantRecommendation = `Expected default amount ${expected.amount}.`;
  } else if (expected.currency && paymentConfig?.currency && expected.currency !== paymentConfig.currency) {
    merchantStatus = "FAIL";
    merchantSeverity = "blocker";
    merchantTitle = "Currency does not match evaluation profile";
    merchantRecommendation = `Expected currency ${expected.currency}.`;
  }
  addFinding(findings, {
    id: "merchant.config",
    status: merchantStatus,
    severity: merchantSeverity,
    capability: "Payment target is explicit and stable.",
    title: merchantTitle,
    evidence: configEvidence,
    recommendation: merchantRecommendation
  });

  const dependencyEvidence = firstEvidence(texts, [/openclaw-payment-skills/i, /agent-payment-skills/i, /agentic-payment-skills/i, /clink-payment-skill/i, /clink-cli/i]);
  addFinding(findings, dependencyEvidence ? {
    id: "payment.runtime_dependency",
    status: "PASS",
    capability: "Skill delegates payment execution to Clink agent payment infrastructure.",
    title: "Clink payment runtime dependency found",
    evidence: [dependencyEvidence]
  } : {
    id: "payment.runtime_dependency",
    status: "FAIL",
    severity: "blocker",
    capability: "Skill delegates payment execution to Clink agent payment infrastructure.",
    title: "No Clink agent payment runtime dependency found",
    recommendation: "Reference openclaw-payment-skills, agent-payment-skills, agentic-payment-skills, clink-payment-skill, or clink-cli according to the runtime."
  });

  const walletEvidence = firstEvidence(texts, [/pre_check_account/i, /get_binding_link/i, /card binding-link/i, /payment method/i, /wallet init/i]);
  addFinding(findings, walletEvidence ? {
    id: "wallet.readiness",
    status: "PASS",
    capability: "Skill checks wallet and payment-method readiness before charging.",
    title: "Wallet/payment-method readiness flow found",
    evidence: [walletEvidence]
  } : {
    id: "wallet.readiness",
    status: "WARN",
    capability: "Skill checks wallet and payment-method readiness before charging.",
    title: "Wallet readiness flow is not evident",
    recommendation: "Call pre_check_account or refresh payment methods before clink_pay; block if no method is bound."
  });

  const authEvidence = firstEvidence(texts, [/explicit authorization/i, /authorize/i, /approval/i, /exact .*amount/i, /exact recharge amount/i, /ask the human/i]);
  addFinding(findings, authEvidence ? {
    id: "authorization.exact_charge",
    status: "PASS",
    capability: "Human authorizes the exact charge.",
    title: "Exact-charge authorization language found",
    evidence: [authEvidence]
  } : {
    id: "authorization.exact_charge",
    status: "WARN",
    capability: "Human authorizes the exact charge.",
    title: "Exact-charge authorization is not evident",
    recommendation: "Require explicit approval for merchant, amount, currency, and reason before charging."
  });

  const validContract = contracts.find((contract) => !contract.error);
  const contractJson = validContract?.json;
  const hasServer = !!(contractJson?.server || contractJson?.merchant_integration?.server);
  const hasTool = !!(contractJson?.confirm_tool || contractJson?.merchant_integration?.confirm_tool);
  const hasOrder = !!(contractJson?.payment_handoff?.order_id || contractJson?.confirm_args?.order_id);
  const handoffTextEvidence = firstEvidence(texts, [/payment_handoff/i, /merchant_integration/i, /confirm_tool/i]);
  if (validContract && hasServer && hasTool && hasOrder) {
    addFinding(findings, {
      id: "handoff.contract",
      status: "PASS",
      capability: "Payment success can be handed off to merchant confirmation.",
      title: "Structured merchant handoff contract found",
      evidence: [validContract.rel]
    });
  } else if (handoffTextEvidence) {
    addFinding(findings, {
      id: "handoff.contract",
      status: "WARN",
      capability: "Payment success can be handed off to merchant confirmation.",
      title: "Handoff is mentioned but contract is incomplete or unparseable",
      evidence: contracts.map((contract) => contract.error ? `${contract.rel}: ${contract.error}` : contract.rel).concat([handoffTextEvidence]),
      recommendation: "Provide a JSON handoff contract with server, confirm_tool, and payment_handoff.order_id."
    });
  } else {
    addFinding(findings, {
      id: "handoff.contract",
      status: "FAIL",
      severity: "blocker",
      capability: "Payment success can be handed off to merchant confirmation.",
      title: "No merchant handoff contract found",
      recommendation: "Declare merchant_integration.server, confirm_tool, confirm_args, and structured payment_handoff."
    });
  }

  const confirmationEvidence = firstEvidence(texts, [/recharge\/check/i, /check_recharge_status/i, /confirm.*exactly once/i, /merchant confirmation/i, /resume.*after.*confirmation/i]);
  addFinding(findings, confirmationEvidence ? {
    id: "merchant.confirmation",
    status: "PASS",
    capability: "Merchant value is confirmed after payment before task resume.",
    title: "Merchant confirmation path found",
    evidence: [confirmationEvidence]
  } : {
    id: "merchant.confirmation",
    status: "FAIL",
    severity: "blocker",
    capability: "Merchant value is confirmed after payment before task resume.",
    title: "Merchant confirmation path is missing",
    recommendation: "Add an idempotent confirmation tool and resume only after confirmation succeeds."
  });

  const failurePatterns = [
    /3DS/i,
    /card declined/i,
    /risk/i,
    /timeout/i,
    /unknown payment state/i,
    /email.*verification/i,
    /status[`'"\s:=]*3/i,
    /status[`'"\s:=]*4/i,
    /status[`'"\s:=]*6/i
  ];
  const failureHits = failurePatterns.map((pattern) => firstEvidence(texts, pattern)).filter(Boolean);
  addFinding(findings, failureHits.length >= 4 ? {
    id: "failure.semantics",
    status: "PASS",
    capability: "Payment failure states are handled safely.",
    title: "Failure semantics are covered",
    evidence: [...new Set(failureHits)].slice(0, 6)
  } : {
    id: "failure.semantics",
    status: failureHits.length ? "WARN" : "FAIL",
    severity: failureHits.length ? "warn" : "blocker",
    capability: "Payment failure states are handled safely.",
    title: "Failure semantics are incomplete",
    evidence: [...new Set(failureHits)].slice(0, 6),
    recommendation: "Cover no card, email verification failure, card decline, risk-rule block, 3DS, timeout/unknown state, and merchant confirmation failure."
  });

  const expectedMerchantBase = expected.merchantApiBaseUrl;
  const hardcodedMerchantUrls = allUrls.filter((url) => {
    if (/clinkbill\.com|docs\.clinkbill\.com/i.test(url)) return false;
    if (!/\/platform\/v\d+\//i.test(url) && !/\/\/api[.-]/i.test(url)) return false;
    return true;
  });
  const envEvidence = hardcodedMerchantUrls.slice(0, 10);
  let envStatus = "PASS";
  let envTitle = "No environment mismatch detected";
  let envRecommendation = "";
  if (expectedMerchantBase) {
    const mismatches = hardcodedMerchantUrls.filter((url) => {
      try {
        return new URL(url).origin !== new URL(expectedMerchantBase).origin;
      } catch {
        return false;
      }
    });
    const matches = hardcodedMerchantUrls.filter((url) => {
      try {
        return new URL(url).origin === new URL(expectedMerchantBase).origin;
      } catch {
        return false;
      }
    });
    if (mismatches.length && !matches.length) {
      envStatus = "FAIL";
      envTitle = "Merchant API base URL appears to target the wrong environment";
      envRecommendation = `Expected merchant API base URL ${expectedMerchantBase}; avoid hardcoded conflicting domains or make the base URL runtime-configurable.`;
    } else if (mismatches.length) {
      envStatus = "WARN";
      envTitle = "Mixed merchant API environments found";
      envRecommendation = "Separate sandbox/production configuration and avoid hardcoded domains in uploaded skills.";
    }
  } else if (hardcodedMerchantUrls.length) {
    envStatus = "WARN";
    envTitle = "Hardcoded merchant API URLs found";
    envRecommendation = "Provide expected.merchantApiBaseUrl in the evaluation profile or make merchant API base URL runtime-configurable.";
  }
  addFinding(findings, {
    id: "environment.consistency",
    status: envStatus,
    severity: envStatus === "FAIL" ? "blocker" : envStatus === "WARN" ? "warn" : "info",
    capability: "Skill targets the same environment as the Clink merchant verifier.",
    title: envTitle,
    evidence: envEvidence,
    recommendation: envRecommendation
  });

  const scoreResult = score(findings);
  return {
    mode: "static",
    root,
    fileCount: files.length,
    profile: profile?.evaluationId || null,
    summary: {
      score: scoreResult,
      recommendation: recommendation(findings, scoreResult),
      failCount: findings.filter((item) => item.status === "FAIL").length,
      warnCount: findings.filter((item) => item.status === "WARN").length,
      blockedCount: findings.filter((item) => item.status === "BLOCKED").length
    },
    extracted: {
      merchantIds,
      paymentConfig,
      contracts: contracts.map((contract) => ({ rel: contract.rel, valid: !contract.error, error: contract.error || null })),
      urls: allUrls
    },
    findings
  };
}

function resolveMcporterCli() {
  const candidate = path.join(process.env.APPDATA || "", "npm", "node_modules", "mcporter", "dist", "cli.js");
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(checker, [command], { encoding: "utf8", windowsHide: true });
  return {
    available: result.status === 0,
    output: (result.stdout || result.stderr || "").trim()
  };
}

function callMcporter(tool, payload, timeoutMs = 180000) {
  const cli = resolveMcporterCli();
  if (!cli) throw new Error("mcporter CLI not found in APPDATA npm global modules.");
  const config = path.join(os.homedir(), ".openclaw", "config", "mcporter.json");
  const result = spawnSync(process.execPath, [cli, "--config", config, "call", tool, "--args", JSON.stringify(payload || {})], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    env: process.env
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || null
  };
}

function listMcporterServer(server) {
  const cli = resolveMcporterCli();
  if (!cli) return { status: "BLOCKED", message: "mcporter CLI not found." };
  const config = path.join(os.homedir(), ".openclaw", "config", "mcporter.json");
  const result = spawnSync(process.execPath, [cli, "--config", config, "list", server, "--json"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000
  });
  let parsed = null;
  try {
    parsed = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {
    parsed = null;
  }
  return {
    status: result.status === 0 && parsed?.status === "ok" ? "PASS" : "FAIL",
    exitCode: result.status,
    server,
    parsed,
    stderr: result.stderr || ""
  };
}

function extractOrderId(text) {
  return text.match(/\border_[a-z0-9]+\b/i)?.[0] || null;
}

function httpGetJson(url, bearerToken) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const headers = { Accept: "application/json" };
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    const request = https.request({
      method: "GET",
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers,
      timeout: 30000
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: body ? JSON.parse(body) : null });
        } catch {
          resolve({ status: response.statusCode, body });
        }
      });
    });
    request.on("error", (error) => resolve({ error: error.message }));
    request.end();
  });
}

async function evaluateLive({ staticReport, profile, allowCharge }) {
  if (!allowCharge) {
    return {
      ...staticReport,
      mode: "clink-live",
      live: {
        status: "BLOCKED",
        message: "Live payment evaluation requires --allow-charge."
      }
    };
  }
  const live = profile?.live || {};
  const expected = profile?.expected || {};
  const runtimeChecks = {
    mcporterCli: resolveMcporterCli() ? { status: "PASS" } : { status: "BLOCKED", message: "mcporter CLI not found" },
    openclawCommand: commandExists("openclaw"),
    agentPaymentServer: listMcporterServer("agent-payment-skills"),
    merchantServer: live.merchantIntegration?.server ? listMcporterServer(live.merchantIntegration.server) : null
  };
  const missing = [];
  if (!live.email) missing.push("live.email");
  if (!expected.merchantId) missing.push("expected.merchantId");
  if (expected.amount === undefined) missing.push("expected.amount");
  if (!expected.currency) missing.push("expected.currency");
  if (!live.merchantIntegration?.server) missing.push("live.merchantIntegration.server");
  if (!live.merchantIntegration?.confirm_tool) missing.push("live.merchantIntegration.confirm_tool");
  if (missing.length) {
    return { ...staticReport, mode: "clink-live", runtimeChecks, live: { status: "BLOCKED", message: `Missing profile fields: ${missing.join(", ")}` } };
  }

  const steps = [];
  steps.push({ name: "initialize_wallet", result: callMcporter("agent-payment-skills.initialize_wallet", { email: live.email, name: live.name || "Clink Agent Payment Eval", locale: live.notify?.locale || "zh-CN" }) });
  steps.push({ name: "pre_check_account", result: callMcporter("agent-payment-skills.pre_check_account", {}) });
  const precheck = steps[steps.length - 1].result.stdout;
  if (!/PASSED|Ready to charge/i.test(precheck)) {
    return { ...staticReport, mode: "clink-live", runtimeChecks, live: { status: "FAIL", steps, message: "Wallet pre-check did not pass." } };
  }
  const payload = {
    merchant_id: expected.merchantId,
    amount: Number(expected.amount),
    currency: expected.currency,
    merchant_integration: live.merchantIntegration,
    channel: live.notify?.channel,
    target_id: live.notify?.target_id,
    target_type: live.notify?.target_type,
    locale: live.notify?.locale
  };
  steps.push({ name: "clink_pay", result: callMcporter("agent-payment-skills.clink_pay", payload, 240000) });
  const payOut = steps[steps.length - 1].result.stdout;
  const orderId = extractOrderId(payOut);
  const paymentSucceeded = /succeeded|Payment already succeeded|Payment Successful/i.test(payOut);
  const liveResult = {
    status: paymentSucceeded ? "PASS" : "FAIL",
    orderId,
    steps
  };

  const confirmation = profile?.merchantConfirmation;
  if (paymentSucceeded && orderId && confirmation?.type === "http-get" && confirmation.urlTemplate) {
    const token = confirmation.bearerTokenEnv ? process.env[confirmation.bearerTokenEnv] : null;
    const url = confirmation.urlTemplate.replace(/\{order_id\}/g, encodeURIComponent(orderId));
    liveResult.merchantConfirmation = await httpGetJson(url, token);
  }
  return { ...staticReport, mode: "clink-live", runtimeChecks, live: liveResult };
}

function writeReport(report, outPath) {
  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, json, "utf8");
    const markdownPath = outPath.replace(/\.json$/i, ".md");
    fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  }
  console.log(json);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Clink Agent Payment Evaluation`);
  lines.push("");
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Recommendation: ${report.summary?.recommendation}`);
  lines.push(`- Score: ${report.summary?.score?.earned}/${report.summary?.score?.possible} (${report.summary?.score?.percentage}%)`);
  lines.push(`- Fails: ${report.summary?.failCount}`);
  lines.push(`- Warnings: ${report.summary?.warnCount}`);
  if (report.live) {
    lines.push(`- Live status: ${report.live.status}`);
    if (report.live.orderId) lines.push(`- Order ID: ${report.live.orderId}`);
  }
  if (report.runtimeChecks) {
    lines.push(`- Runtime mcporter: ${report.runtimeChecks.mcporterCli?.status}`);
    lines.push(`- Runtime openclaw command: ${report.runtimeChecks.openclawCommand?.available ? "PASS" : "FAIL"}`);
    lines.push(`- Runtime agent-payment server: ${report.runtimeChecks.agentPaymentServer?.status}`);
    if (report.runtimeChecks.merchantServer) lines.push(`- Runtime merchant server: ${report.runtimeChecks.merchantServer.status}`);
  }
  lines.push("");
  lines.push("## Findings");
  for (const finding of report.findings || []) {
    lines.push("");
    lines.push(`### ${finding.status} ${finding.id}`);
    lines.push("");
    lines.push(`- ${finding.title}`);
    lines.push(`- Capability: ${finding.capability}`);
    if (finding.evidence?.length) lines.push(`- Evidence: ${finding.evidence.join("; ")}`);
    if (finding.recommendation) lines.push(`- Recommendation: ${finding.recommendation}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.skill) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  const skillPath = path.resolve(args.skill);
  const profile = args.profile ? readJson(path.resolve(args.profile)) : null;
  const { root, tempDir } = findSkillRoot(skillPath);
  try {
    const staticReport = evaluateStatic({ root, profile });
    const report = args.mode === "clink-live"
      ? await evaluateLive({ staticReport, profile, allowCharge: args.allowCharge })
      : staticReport;
    writeReport(report, args.out ? path.resolve(args.out) : null);
    const failed = report.summary?.recommendation === "not_certified";
    process.exit(failed ? 2 : 0);
  } finally {
    if (tempDir && !args.keepTemp) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
