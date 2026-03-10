const fs = require("fs").promises;
const path = require("path");

const STRIPE_API_KEY = process.env.MCP_STRIPE_API_KEY;

if (!STRIPE_API_KEY) {
  throw new Error("MCP_STRIPE_API_KEY environment variable is required");
}

const getMCPPrompt = async (promptName) => {
  const response = await fetch("https://mcp.stripe.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${STRIPE_API_KEY}`,
      "User-Agent": "github.com/stripe/ai/skills",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: promptName,
        arguments: {},
      },
      id: 1,
    }),
  });
  const data = await response.json();
  return data.result.messages[0].content.text;
};

const listMCPPrompts = async () => {
  const response = await fetch("https://mcp.stripe.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${STRIPE_API_KEY}`,
      "User-Agent": "github.com/stripe/ai/skills",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "prompts/list",
      params: {},
      id: 1,
    }),
  });
  const data = await response.json();
  return data.result.prompts;
};

// Split content on <!-- reference:filename.md --> markers.
// Returns { skillBody, references: [{ filename, content }] }.
// If no markers are found, skillBody is the full content and references is empty.
const REFERENCE_MARKER_RE = /^<!-- reference:(.+?) -->\s*$/gm;

const splitReferences = (content) => {
  const markers = [...content.matchAll(REFERENCE_MARKER_RE)];

  if (markers.length === 0) {
    return { skillBody: content, references: [] };
  }

  // Everything before the first marker is the SKILL.md body
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

// Rewrite "See X section below" table cells to reference file links
// when reference files exist for the skill.
const rewriteTableLinks = (skillBody, references) => {
  if (references.length === 0) return skillBody;

  let result = skillBody;
  for (const ref of references) {
    // Match patterns like "See Payments section below" and replace with file link
    // The section name is derived from the first H2 heading in the reference content
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

const run = async () => {
  const prompts = await listMCPPrompts();
  console.log(`Found ${prompts.length} prompts`);

  const outputLocations = [
    __dirname,
    path.join(__dirname, "../providers/claude/plugin/skills"),
    path.join(__dirname, "../providers/cursor/plugin/skills"),
  ];

  for (const prompt of prompts) {
    const content = await getMCPPrompt(prompt.name);
    const { skillBody, references } = splitReferences(content);

    // For the SKILL.md body, rewrite inline section pointers to file references
    const finalSkillBody = rewriteTableLinks(skillBody, references);

    const skillFileContent = `---
name: ${prompt.name}
description: ${prompt.description}
---

${finalSkillBody}
`;

    for (const location of outputLocations) {
      const outputDir = path.join(location, prompt.name);
      await fs.mkdir(outputDir, { recursive: true });

      const outputPath = path.join(outputDir, "SKILL.md");
      await fs.writeFile(outputPath, skillFileContent, "utf8");
      console.log(`Content written to ${outputPath}`);

      if (references.length > 0) {
        const refsDir = path.join(outputDir, "references");
        await fs.mkdir(refsDir, { recursive: true });

        for (const ref of references) {
          const refPath = path.join(refsDir, ref.filename);
          await fs.writeFile(refPath, ref.content + "\n", "utf8");
          console.log(`Reference written to ${refPath}`);
        }
      }
    }
  }
};

run();
