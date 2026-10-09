import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client";
import { addUsage, costUsd, emptyUsage, usageFromApi, type UsageCounts } from "./pricing";
import { db, schema } from "@/db";

export type LlmStage = (typeof schema.llmStage.enumValues)[number];

/** Attribution for the cost tracker. Every Anthropic call in the app goes through this module. */
export type CallCtx = {
  stage: LlmStage;
  runId?: string | null;
  userId?: string | null;
  prospectId?: string | null;
  companyKey?: string | null;
  industryKey?: string | null;
  emailId?: string | null;
};

const MAX_PAUSE_RESUMES = 4;

export async function logUsage(
  ctx: CallCtx,
  model: string,
  usage: UsageCounts,
  opts: { batch?: boolean } = {},
): Promise<number> {
  const cost = costUsd(model, usage, opts);
  try {
    await db.insert(schema.usageLogs).values({
      runId: ctx.runId ?? null,
      userId: ctx.userId ?? null,
      stage: ctx.stage,
      model,
      batch: !!opts.batch,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWrite5mTokens + usage.cacheWrite1hTokens,
      webSearches: usage.webSearches,
      webFetches: usage.webFetches,
      costUsd: cost.toFixed(6),
      prospectId: ctx.prospectId ?? null,
      companyKey: ctx.companyKey ?? null,
      industryKey: ctx.industryKey ?? null,
      emailId: ctx.emailId ?? null,
    });
  } catch (err) {
    // Cost logging must never break the pipeline, but it must be visible.
    console.error("[cost-tracker] failed to write usage log", err);
  }
  return cost;
}

export type RunResult = { message: Anthropic.Message; usage: UsageCounts; costUsd: number };

/**
 * Runs one Messages request to completion (resuming server-tool `pause_turn`s),
 * then records the summed usage once.
 */
export async function runMessage(
  ctx: CallCtx,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<RunResult> {
  const messages: Anthropic.MessageParam[] = [...params.messages];
  let usage = emptyUsage();
  let message: Anthropic.Message | null = null;
  try {
    for (let i = 0; i <= MAX_PAUSE_RESUMES; i++) {
      message = await anthropic().messages.create({ ...params, messages });
      usage = addUsage(usage, usageFromApi(message.usage));
      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }
  } finally {
    // Log whatever was consumed, even if a later resume threw.
    if (usage.inputTokens || usage.outputTokens) {
      await logUsage(ctx, params.model, usage);
    }
  }
  if (!message) throw new Error("No response from model");
  if (message.stop_reason === "refusal") {
    throw new Error(`Model declined the request (${message.stop_details?.category ?? "unspecified"})`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Model output hit max_tokens before finishing");
  }
  if (message.stop_reason === "pause_turn") {
    throw new Error("Model was still working after the maximum number of resumes");
  }
  return { message, usage, costUsd: costUsd(params.model, usage) };
}

/** Text the model wrote after its last tool activity (i.e. the final answer). */
export function finalText(message: Anthropic.Message): string {
  const blocks = message.content;
  let lastNonText = -1;
  blocks.forEach((b, i) => {
    if (b.type !== "text" && b.type !== "thinking" && b.type !== "redacted_thinking") lastNonText = i;
  });
  return blocks
    .slice(lastNonText + 1)
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Extracts the outermost JSON object from model text (tolerates code fences / stray prose). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Runs a request whose final answer must match `schema`.
 * Uses structured outputs; if the API rejects the format for this request shape
 * (e.g. combined with certain server tools), retries once with prompt-level JSON instructions.
 */
export async function runJson<S extends z.ZodType>(
  ctx: CallCtx,
  params: Anthropic.MessageCreateParamsNonStreaming,
  schemaDef: S,
): Promise<{ data: z.infer<S>; result: RunResult }> {
  let result: RunResult;
  try {
    result = await runMessage(ctx, {
      ...params,
      output_config: { ...(params.output_config ?? {}), format: zodOutputFormat(schemaDef) },
    });
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError) || !/format|schema|citation/i.test(err.message)) throw err;
    const jsonSchema = JSON.stringify(z.toJSONSchema(schemaDef));
    const messages: Anthropic.MessageParam[] = [
      ...params.messages,
      {
        role: "user",
        content: `Return your final answer as a single JSON object matching this JSON Schema, with no other text:\n${jsonSchema}`,
      },
    ];
    result = await runMessage(ctx, { ...params, messages });
  }
  const parsed = schemaDef.safeParse(extractJson(finalText(result.message)));
  if (!parsed.success) {
    throw new Error(`Model output failed validation: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join("; ")}`);
  }
  return { data: parsed.data, result };
}
