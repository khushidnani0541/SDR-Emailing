import { env } from "@/lib/env";

// Minimal client for the Collateral Librarian MCP server (stateless Streamable HTTP, JSON-RPC 2.0).
// Retrieval is deterministic server code: the model never browses the catalog itself,
// which keeps tokens down (the catalog map alone is several thousand tokens).

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  error?: { code: number; message: string };
};

let nextId = 1;

async function rpc(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<JsonRpcResponse> {
  const res = await fetch(env().LIBRARIAN_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Librarian ${method} failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (contentType.includes("text/event-stream")) {
    // Take the last JSON-RPC message carried in `data:` lines.
    const payloads = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (!payloads.length) throw new Error(`Librarian ${method}: empty event stream`);
    return JSON.parse(payloads[payloads.length - 1]);
  }
  return JSON.parse(raw);
}

/** Calls a Librarian tool and returns its text output. */
export async function callLibrarian(tool: string, args: Record<string, unknown> = {}): Promise<string> {
  const response = await rpc("tools/call", { name: tool, arguments: args });
  if (response.error) throw new Error(`Librarian ${tool}: ${response.error.message}`);
  const text = (response.result?.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  if (response.result?.isError) throw new Error(`Librarian ${tool}: ${text.slice(0, 300)}`);
  return text;
}

export const LIBRARIAN_INDUSTRIES = [
  "manufacturing",
  "energy-utilities",
  "water",
  "pharma",
  "fmcg",
  "automotive",
  "fintech",
  "healthcare",
  "logistics",
  "real-estate",
  "general",
] as const;

export type LibrarianIndustry = (typeof LIBRARIAN_INDUSTRIES)[number];

export const librarian = {
  listDocuments: (args: {
    type?: string;
    industry?: string;
    client?: string;
    tag?: string;
    query?: string;
    verbose?: boolean;
    offset?: number;
    limit?: number;
  }) => callLibrarian("list_documents", args),
  search: (args: { query: string; type?: string; industry?: string; limit?: number }) => callLibrarian("search", args),
  ask: (question: string) => callLibrarian("ask", { question }),
  getDocument: (id: string) => callLibrarian("get_document", { id }),
};
