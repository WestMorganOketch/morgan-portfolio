import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standardFontDataUrl = pathToFileURL(`${join(clientRoot, "node_modules", "pdfjs-dist", "standard_fonts")}${process.platform === "win32" ? "\\" : "/"}`).href;
const nextBuildId = join(clientRoot, ".next", "BUILD_ID");
assert.ok(existsSync(nextBuildId), "Run npm run build before npm run verify:resume.");

function transpileModule(source, extraProfile) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "__profile", code)(exports, extraProfile);
  return exports;
}

const profileSource = readFileSync(join(clientRoot, "src", "data", "profile.ts"), "utf8");
const profileModule = transpileModule(profileSource);
const resumeSource = readFileSync(join(clientRoot, "src", "data", "resume.ts"), "utf8")
  .replace('import { profile } from "./profile";', "const profile = __profile;");
const resumeModule = transpileModule(resumeSource, profileModule.profile);
const { resume } = resumeModule;
const textSource = readFileSync(join(clientRoot, "src", "lib", "resumePdfText.ts"), "utf8");
const { normalizeResumePdfText } = transpileModule(textSource);
const normalizedSample = normalizeResumePdfText("“Résumé” ’quote’ ‑hyphen → é – — · • 😀");
assert.equal(normalizedSample, '"Résumé" \'quote\' -hyphen -> é – — · • ');
assert.equal(resume.showPhone, false);

const portServer = createServer();
await new Promise((resolveListen, rejectListen) => {
  portServer.once("error", rejectListen);
  portServer.listen(0, "127.0.0.1", resolveListen);
});
const address = portServer.address();
assert.ok(address && typeof address === "object");
const port = address.port;
await new Promise((resolveClose, rejectClose) => portServer.close((error) => error ? rejectClose(error) : resolveClose()));

const origin = `http://127.0.0.1:${port}`;
const nextCli = join(clientRoot, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: clientRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.setEncoding("utf8").on("data", (chunk) => { serverOutput += chunk; });
server.stderr.setEncoding("utf8").on("data", (chunk) => { serverOutput += chunk; });

async function waitForServer() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Production server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${origin}/resume`);
      if (response.status === 200) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      continue;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error(`Production server did not become ready:\n${serverOutput}`);
}

function stripScriptAndStyleBlocks(input) {
  let previous;
  let current = input;
  do {
    previous = current;
    current = current
      .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, "");
  } while (current !== previous);
  return current;
}

async function fetchPageAndPdf() {
  const pageResponse = await fetch(`${origin}/resume`);
  assert.equal(pageResponse.status, 200, "GET /resume must return 200.");
  const html = await pageResponse.text();
  const visibleHtml = stripScriptAndStyleBlocks(html);
  const headings = [...visibleHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  assert.equal(headings.length, 1, "The page must contain exactly one h1.");
  assert.match(headings[0][1].replace(/[<>]/g, ""), /Morgan West Oketch/);
  assert.match(visibleHtml, /<link[^>]+rel="canonical"[^>]+href="[^"]*\/resume"/i, "Missing canonical metadata.");
  for (const heading of ["Professional Summary", "Skills", "Experience", "Projects", "Education", "Certifications", "References"]) {
    assert.ok(visibleHtml.includes(heading), `Missing résumé section heading: ${heading}`);
  }
  assert.ok(visibleHtml.includes('aria-label="Download résumé as PDF"'), "Missing accessible PDF download link.");
  assert.ok(visibleHtml.includes('aria-label="Print résumé"'), "Missing accessible print control.");
  assert.ok(visibleHtml.includes('download="Morgan-West-Oketch-Resume.pdf"'), "Download link must provide the expected filename.");
  const actionStart = visibleHtml.indexOf('aria-label="Résumé actions"');
  const toolbarOrder = [
    visibleHtml.indexOf(">Back<", actionStart),
    visibleHtml.indexOf('aria-label="Download résumé as PDF"', actionStart),
    visibleHtml.indexOf('aria-label="Print résumé"', actionStart),
    visibleHtml.indexOf("<h1", actionStart),
  ];
  assert.ok(toolbarOrder.every((position, index) => position >= 0 && (index === 0 || position > toolbarOrder[index - 1])), "Toolbar and content order must be Back, Download, Print, then résumé content.");
  assert.ok(!/undefined|\[object Object\]/i.test(visibleHtml), "Visible page contains an invalid fallback string.");
  const visibleText = visibleHtml.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/gi, " ");
  assert.ok(!/\b(?:\+?254[\s.-]?)?\d{3,4}[\s.-]?\d{3}[\s.-]?\d{3}\b/.test(visibleText), "A phone number was rendered.");
  assert.ok(visibleHtml.includes("More documents and certificates"));

  const pdfResponse = await fetch(`${origin}/resume.pdf`);
  assert.equal(pdfResponse.status, 200, "GET /resume.pdf must return 200.");
  assert.match(pdfResponse.headers.get("content-type") ?? "", /^application\/pdf\b/i);
  assert.match(pdfResponse.headers.get("content-disposition") ?? "", /attachment;\s*filename="Morgan-West-Oketch-Resume\.pdf"/i);
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
  assert.ok(new TextDecoder().decode(pdfBytes.slice(0, 5)).startsWith("%PDF-"), "PDF response must start with %PDF-.");
  assert.ok(pdfBytes.byteLength < 250 * 1024, `PDF exceeds 250 KB (${pdfBytes.byteLength} bytes).`);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfDocument = await pdfjs.getDocument({
    data: pdfBytes.slice(),
    useSystemFonts: true,
    standardFontDataUrl,
  }).promise;
  assert.ok(pdfDocument.numPages <= 2, `ATS PDF has ${pdfDocument.numPages} pages; maximum is 2.`);
  const pdfMetadata = await pdfDocument.getMetadata();
  assert.equal(pdfMetadata.info.Title, "Morgan-West-Oketch-Resume");
  assert.equal(pdfMetadata.info.Author, resume.name);
  assert.equal(pdfMetadata.info.Subject, "Résumé");
  assert.equal(pdfMetadata.info.Language, "en");

  const extractedPages = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const pdfPage = await pdfDocument.getPage(pageNumber);
    const textContent = await pdfPage.getTextContent();
    extractedPages.push(textContent.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  const extracted = extractedPages.join(" ").replace(/\s+/g, " ").trim();
  assert.ok(pdfDocument.numPages <= 2, `ATS PDF has ${pdfDocument.numPages} pages; maximum is 2. ${extractedPages.map((text, index) => `Page ${index + 1}: ${text.slice(0, 100)} ... ${text.slice(-100)}`).join(" | ")}`);
  assert.ok(!/[\uFFFD\u25A1]/.test(extracted), "PDF text contains a replacement or missing-glyph character.");
  const orderedText = [
    "Professional Summary",
    resume.summary,
    "Skills",
  ];
  let priorHeading;
  for (const skill of resume.skills) {
    if (skill.heading !== priorHeading) orderedText.push(skill.heading);
    orderedText.push(`${skill.label}: ${skill.items}`);
    priorHeading = skill.heading;
  }
  orderedText.push("Experience");
  for (const entry of resume.experience) {
    orderedText.push(`${entry.role}, ${entry.organisation}`, `${entry.period}, ${entry.location}`, ...entry.bullets);
  }
  orderedText.push("Projects");
  for (const project of resume.projects) {
    orderedText.push(`${project.title} — ${project.subtitle}`);
    if (project.href) orderedText.push(project.href.replace("https://", ""));
    orderedText.push(project.body);
  }
  orderedText.push("Education", resume.education.qualification);
  orderedText.push(`${resume.education.institution}, ${resume.education.location} — ${resume.education.period}`);
  orderedText.push(`Relevant Coursework: ${resume.education.coursework}`, "Certifications");
  for (const certification of resume.certifications) {
    orderedText.push(`${certification.name} — ${certification.issuer} (${certification.date})`);
  }
  orderedText.push("References", resume.references);
  let previousIndex = -1;
  for (const sourceText of orderedText) {
    const expected = normalizeResumePdfText(sourceText).replace(/\s+/g, " ").trim();
    const foundAt = extracted.indexOf(expected, previousIndex + 1);
    assert.notEqual(foundAt, -1, `PDF text missing or out of order: ${expected}`);
    previousIndex = foundAt;
  }
  console.log(`PASS /resume HTML; PASS ATS PDF (${pdfBytes.byteLength} bytes, ${pdfDocument.numPages} page(s), metadata); PASS ordered text fidelity and normalization.`);
  return { pdfjs, resumePdf: pdfBytes };
}

async function verifyPrint(pdfjs, resumePdf) {
  const edgePaths = [
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe") : "",
  ].filter(Boolean);
  const edge = edgePaths.find(existsSync);
  if (!edge) {
    console.log("UNVERIFIED browser print: Edge was not found.");
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "resume-print-"));
  const printPath = join(tempDir, "resume-print.pdf");
  const printServer = spawn(edge, [
    "--headless", "--disable-gpu", "--no-pdf-header-footer", "--no-first-run",
    `--user-data-dir=${join(tempDir, "profile")}`,
    `--print-to-pdf=${printPath}`,
    `${origin}/resume`,
  ], { stdio: "ignore" });
  try {
    await new Promise((resolvePrint, rejectPrint) => {
      const timeout = setTimeout(() => {
        printServer.kill();
        rejectPrint(new Error("Edge headless print timed out."));
      }, 45000);
      printServer.once("error", (error) => {
        clearTimeout(timeout);
        rejectPrint(error);
      });
      printServer.once("exit", () => {
        clearTimeout(timeout);
        resolvePrint();
      });
    });
    assert.ok(existsSync(printPath), "Edge did not create its print PDF.");
    const printed = new Uint8Array(readFileSync(printPath));
    const printedPdf = await pdfjs.getDocument({
      data: printed.slice(),
      useSystemFonts: true,
      standardFontDataUrl,
    }).promise;
    const printText = [];
    for (let pageNumber = 1; pageNumber <= printedPdf.numPages; pageNumber += 1) {
      const page = await printedPdf.getPage(pageNumber);
      const text = await page.getTextContent();
      printText.push(text.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    const renderedText = printText.join(" ").replace(/\s+/g, " ");
    assert.ok(printedPdf.numPages <= 2, `Browser print produced ${printedPdf.numPages} pages; maximum is 2. ${printText.map((text, index) => `Page ${index + 1}: ${text.slice(0, 100)} ... ${text.slice(-100)}`).join(" | ")}`);
    for (const hiddenText of ["Download PDF (ATS)", "Print résumé", "MORGAN OKETCH"]) {
      assert.ok(!renderedText.includes(hiddenText), `Print output unexpectedly includes hidden toolbar/navigation text: ${hiddenText}`);
    }
    console.log(`PASS Edge headless print (${printedPdf.numPages} page(s)); toolbar and navigation text absent.`);
  } finally {
    if (printServer.exitCode === null) printServer.kill();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  await waitForServer();
  const { pdfjs, resumePdf } = await fetchPageAndPdf();
  await verifyPrint(pdfjs, resumePdf);
} finally {
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolveExit) => server.once("exit", resolveExit));
  }
}
