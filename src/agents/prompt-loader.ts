import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const AGENTS_DIR = dirname(fileURLToPath(import.meta.url));

const promptSectionsSchema = z.object({
  role: z.string().min(1),
  context: z.string().min(1),
  instructions: z.string().min(1),
  constraints: z.string().min(1),
  output_schema: z.string().min(1),
});

const systemPromptsSchema = z.object({
  context_agent: promptSectionsSchema,
  investigator_agent: promptSectionsSchema,
  reflection_agent: promptSectionsSchema,
});

type PromptKey = keyof z.infer<typeof systemPromptsSchema>;

function renderPrompt(sections: z.infer<typeof promptSectionsSchema>): string {
  return [
    "<role>",
    sections.role.trim(),
    "</role>",
    "",
    "<context>",
    sections.context.trim(),
    "</context>",
    "",
    "<instructions>",
    sections.instructions.trim(),
    "</instructions>",
    "",
    "<constraints>",
    sections.constraints.trim(),
    "</constraints>",
    "",
    "<output_schema>",
    sections.output_schema.trim(),
    "</output_schema>",
  ].join("\n");
}

export function loadPromptConfig(): z.infer<typeof systemPromptsSchema> {
  const rawConfig = Bun.YAML.parse(readFileSync(resolve(AGENTS_DIR, "prompts", "system-prompts.yaml"), "utf8"));
  return systemPromptsSchema.parse(rawConfig);
}

export function loadAgentPrompt(promptKey: PromptKey): string {
  return renderPrompt(loadPromptConfig()[promptKey]);
}
