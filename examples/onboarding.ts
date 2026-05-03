/**
 * Onboarding agent — observer-mode scenegrad demo.
 *
 * A multi-turn conversational agent collecting name, email, role, then
 * sending a welcome email. Uses scenegrad in OBSERVER MODE:
 *   - The agent loop is normal (Anthropic SDK + tools)
 *   - scenegrad sits alongside, snapshotting a (mock) world after each tool
 *   - Each turn, the agent's system prompt gets `status.unmet` injected so
 *     it always knows what's left to do — even after losing context
 *
 * Run: ANTHROPIC_API_KEY=... bun examples/onboarding.ts
 *
 * Watch how the agent's prompts auto-shrink as fields are filled, and how
 * status() reflects the actual world state (not the LLM's memory of it).
 */

import Anthropic from "@anthropic-ai/sdk";
import { observe } from "scenegrad";

// ---------------------------------------------------------------------------
// Mock "world" — a simple in-memory db. In production this would be Postgres,
// Stripe, your CRM, etc. The point: assertions check it, not LLM memory.
// ---------------------------------------------------------------------------

interface World {
  user: {
    name?:    string;
    email?:   string;
    role?:    string;
  };
  emails_sent: string[];
}

const world: World = { user: {}, emails_sent: [] };

// ---------------------------------------------------------------------------
// Goal — assertions checked against the real world
// ---------------------------------------------------------------------------

const watcher = observe<World>({
  snapshot: async () => structuredClone(world),
  goal: (s) => [
    { name: "name_collected",
      check: (s) => ({ satisfied: !!s.user.name?.trim(),  gap: 1 }) },
    { name: "email_collected",
      check: (s) => ({ satisfied: !!s.user.email?.includes("@"), gap: 1 }) },
    { name: "role_specified",
      check: (s) => ({ satisfied: !!s.user.role?.trim(),  gap: 1 }) },
    { name: "welcome_email_sent",
      check: (s) => ({ satisfied: s.emails_sent.includes("welcome"), gap: 1, weight: 0.5 }) },
  ],
});

// ---------------------------------------------------------------------------
// Tools — the agent can call these. They mutate the world.
// ---------------------------------------------------------------------------

const tools: Anthropic.Tool[] = [
  { name: "set_name",     description: "Save the user's full name", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "set_email",    description: "Save the user's email address", input_schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
  { name: "set_role",     description: "Save the user's job role/title", input_schema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] } },
  { name: "send_welcome", description: "Send the welcome email — only AFTER name, email, AND role are all set", input_schema: { type: "object", properties: {}, required: [] } },
];

const handlers: Record<string, (args: any) => string> = {
  set_name:     ({ name })  => { world.user.name  = name;  return `name saved: ${name}`; },
  set_email:    ({ email }) => { world.user.email = email; return `email saved: ${email}`; },
  set_role:     ({ role })  => { world.user.role  = role;  return `role saved: ${role}`; },
  send_welcome: ()          => {
    if (!world.user.name || !world.user.email || !world.user.role) {
      return "ERROR: cannot send welcome before all fields are set";
    }
    world.emails_sent.push("welcome");
    return "welcome email sent";
  },
};

// ---------------------------------------------------------------------------
// Agent turn — invoke Haiku, inject scenegrad status, run tools, record steps
// ---------------------------------------------------------------------------

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const history: Anthropic.MessageParam[] = [];

async function buildSystemPrompt(): Promise<string> {
  const status = await watcher.status();
  const unmet = status.unmet.map(a => a.name).join(", ") || "(none — onboarding complete!)";
  return [
    "You are a friendly onboarding assistant collecting information from a new user.",
    `Progress: ${status.satisfied.length}/${status.assertions.length} steps complete.`,
    `Still unmet: ${unmet}.`,
    "",
    "Rules:",
    "- Ask for the next single unmet item naturally; don't list everything.",
    "- Don't ask about already-satisfied items (they're done).",
    "- Once name, email, AND role are all set, call send_welcome.",
    "- Keep responses to 1-2 sentences.",
  ].join("\n");
}

async function chatTurn(userMessage: string): Promise<string> {
  history.push({ role: "user", content: userMessage });

  // Multi-step within one user turn — Claude can call several tools in sequence
  for (let step = 0; step < 6; step++) {
    const response = await client.messages.create({
      model:   "claude-haiku-4-5",
      max_tokens: 512,
      system:  await buildSystemPrompt(),  // ← scenegrad status injected fresh each step
      tools,
      messages: history,
    });

    history.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");

    if (toolUses.length === 0) {
      return textBlocks.map(b => b.text).join("\n").trim();
    }

    // Run each tool, record a scenegrad step per tool
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const handler = handlers[use.name];
      const result = handler ? handler(use.input as any) : "unknown tool";
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content: result });
      await watcher.recordStep({ tool: { name: use.name, args: use.input as any } });
    }

    history.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") {
      return textBlocks.map(b => b.text).join("\n").trim();
    }
  }
  return "(max steps reached)";
}

// ---------------------------------------------------------------------------
// Run a scripted conversation. Watch status() shrink turn by turn.
// ---------------------------------------------------------------------------

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const userInputs = [
  "hi! I'm signing up.",
  "I'm Alice from Acme",
  "alice@acme.com is my email",
  "I'm Head of Engineering there",
];

for (const input of userInputs) {
  const before = await watcher.status();
  console.log(`\n[scenegrad: ${before.satisfied.length}/${before.assertions.length} done — unmet: ${before.unmet.map(a => a.name).join(", ") || "none"}]`);
  console.log(`USER:  ${input}`);
  const reply = await chatTurn(input);
  console.log(`AGENT: ${reply}`);
}

// Final status
const final = await watcher.status();
console.log(`\n=== Final ===`);
console.log(`done: ${final.done ? "✓" : "✗"}   gap: ${final.gap}   steps: ${watcher.trajectory().length}`);
console.log(`world: ${JSON.stringify(world, null, 2)}`);
console.log(`\nTrajectory:`);
for (const t of watcher.trajectory()) {
  console.log(`  #${t.step} ${t.tool?.name}(${JSON.stringify(t.tool?.args)})  d:${t.d_before}→${t.d_after} (Δ${t.delta})`);
}
