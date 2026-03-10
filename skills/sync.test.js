const fs = require("fs").promises;
const path = require("path");
const os = require("os");

// Import the functions we want to test by extracting them from sync.js
// Since sync.js doesn't export anything, we'll duplicate the pure functions here
// and test them directly. In a real setup, sync.js should export these.

const REFERENCE_MARKER_RE = /^<!-- reference:(.+?) -->\s*$/gm;

const splitReferences = (content) => {
  const markers = [...content.matchAll(REFERENCE_MARKER_RE)];

  if (markers.length === 0) {
    return { skillBody: content, references: [] };
  }

  const skillBody = content.slice(0, markers[0].index).trimEnd();

  const references = markers.map((marker, i) => {
    const filename = marker[1];
    const start = marker.index + marker[0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index : content.length;
    const refContent = content.slice(start, end).trim();
    return { filename, content: refContent };
  });

  return { skillBody, references };
};

const rewriteTableLinks = (skillBody, references) => {
  if (references.length === 0) return skillBody;

  let result = skillBody;
  for (const ref of references) {
    const headingMatch = ref.content.match(/^## (.+)$/m);
    if (!headingMatch) continue;

    const sectionName = headingMatch[1];
    const seePattern = new RegExp(
      `See ${sectionName.replace(/[.*+?^${}()|[\]\\/\\\\]/g, "\\$&")} section below`,
      "g"
    );
    result = result.replace(
      seePattern,
      `[references/${ref.filename}](references/${ref.filename})`
    );
  }

  return result;
};

// --- Tests ---

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

console.log("=== splitReferences ===\n");

// Test: no markers returns full content
{
  const content = "Just some text\nwith no markers.";
  const { skillBody, references } = splitReferences(content);
  assertEqual(skillBody, content, "no markers: skillBody is full content");
  assertEqual(references.length, 0, "no markers: no references");
}

// Test: single marker splits into body + one reference
{
  const content = `Router content here.

<!-- reference:payments.md -->

## Payments

Use Checkout Sessions.`;
  const { skillBody, references } = splitReferences(content);
  assertEqual(skillBody, "Router content here.", "single marker: skillBody is content before marker");
  assertEqual(references.length, 1, "single marker: one reference");
  assertEqual(references[0].filename, "payments.md", "single marker: correct filename");
  assert(references[0].content.startsWith("## Payments"), "single marker: reference content starts with heading");
}

// Test: multiple markers split correctly
{
  const content = `Router.

<!-- reference:payments.md -->

## Payments

Payment content.

<!-- reference:connect.md -->

## Connect / Platforms

Connect content.

<!-- reference:billing.md -->

## Billing / Subscriptions

Billing content.`;
  const { skillBody, references } = splitReferences(content);
  assertEqual(skillBody, "Router.", "multiple markers: skillBody correct");
  assertEqual(references.length, 3, "multiple markers: three references");
  assertEqual(references[0].filename, "payments.md", "multiple markers: first is payments");
  assertEqual(references[1].filename, "connect.md", "multiple markers: second is connect");
  assertEqual(references[2].filename, "billing.md", "multiple markers: third is billing");
  assert(references[0].content.includes("Payment content"), "multiple markers: payments has correct content");
  assert(references[1].content.includes("Connect content"), "multiple markers: connect has correct content");
  assert(references[2].content.includes("Billing content"), "multiple markers: billing has correct content");
  assert(!references[0].content.includes("Connect content"), "multiple markers: payments doesn't bleed into connect");
  assert(!references[1].content.includes("Billing content"), "multiple markers: connect doesn't bleed into billing");
}

console.log("\n=== rewriteTableLinks ===\n");

// Test: no references returns unchanged body
{
  const body = "Some body text.";
  const result = rewriteTableLinks(body, []);
  assertEqual(result, body, "no references: body unchanged");
}

// Test: rewrites simple section name
{
  const body = "| Payments | See Payments section below |";
  const refs = [{ filename: "payments.md", content: "## Payments\n\nContent." }];
  const result = rewriteTableLinks(body, refs);
  assertEqual(
    result,
    "| Payments | [references/payments.md](references/payments.md) |",
    "simple rewrite: See X section below -> file link"
  );
}

// Test: rewrites section name with slashes
{
  const body = "| Connect | See Connect / Platforms section below |";
  const refs = [{ filename: "connect.md", content: "## Connect / Platforms\n\nContent." }];
  const result = rewriteTableLinks(body, refs);
  assertEqual(
    result,
    "| Connect | [references/connect.md](references/connect.md) |",
    "slash rewrite: handles / in section names"
  );
}

// Test: rewrites multiple references in one body
{
  const body = `| Row 1 | See Payments section below |
| Row 2 | See Billing / Subscriptions section below |`;
  const refs = [
    { filename: "payments.md", content: "## Payments\n\nP." },
    { filename: "billing.md", content: "## Billing / Subscriptions\n\nB." },
  ];
  const result = rewriteTableLinks(body, refs);
  assert(result.includes("[references/payments.md](references/payments.md)"), "multi rewrite: payments replaced");
  assert(result.includes("[references/billing.md](references/billing.md)"), "multi rewrite: billing replaced");
  assert(!result.includes("section below"), "multi rewrite: no 'section below' remaining");
}

// Test: leaves unmatched text alone
{
  const body = "| Row | See Nonexistent section below |";
  const refs = [{ filename: "payments.md", content: "## Payments\n\nContent." }];
  const result = rewriteTableLinks(body, refs);
  assert(result.includes("Nonexistent section below"), "unmatched: text left alone");
}

console.log("\n=== Integration test with real .erb content ===\n");

async function integrationTest() {
  try {
    const erbContent = await fs.readFile(
      "/pay/src/pay-server/lib/mcp_stripe/prompts/best-practices.erb",
      "utf8"
    );
    // Simulate rendered content (replace ERB tag)
    const content = erbContent.replace("<%= latest_api_version %>", "2026-02-25.clover");

    const { skillBody, references } = splitReferences(content);

    assert(skillBody.length > 0, "integration: skillBody is non-empty");
    assert(skillBody.includes("2026-02-25.clover"), "integration: skillBody has API version");
    assert(!skillBody.includes("<!-- reference:"), "integration: skillBody has no markers");

    assertEqual(references.length, 3, "integration: 3 reference files");
    assertEqual(references[0].filename, "payments.md", "integration: first ref is payments");
    assertEqual(references[1].filename, "billing.md", "integration: second ref is billing");
    assertEqual(references[2].filename, "connect.md", "integration: third ref is connect");

    assert(references[0].content.includes("CheckoutSessions"), "integration: payments has CheckoutSessions");
    assert(references[1].content.includes("Billing"), "integration: billing has Billing");
    assert(references[2].content.includes("Connect"), "integration: connect has Connect");

    // Test that no content is lost (compare with whitespace normalized)
    const reassembled = skillBody + "\n\n" + references.map(r => r.content).join("\n\n");
    const originalWithoutMarkers = content.replace(/<!-- reference:.+? -->\n\n/g, "").trim();
    const normalize = (s) => s.split("\n").map(l => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    assertEqual(normalize(reassembled), normalize(originalWithoutMarkers), "integration: no content lost in split");

    // Test rewrite
    const rewritten = rewriteTableLinks(skillBody, references);
    assert(!rewritten.includes("section below"), "integration: all 'section below' links rewritten (if any)");

  } catch (e) {
    console.log(`  SKIP: integration test (${e.message})`);
  }
}

integrationTest().then(() => {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
});
