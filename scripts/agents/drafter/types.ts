/** One tool call in an OpenAI-format chat reply. */
export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

export interface ChatReply {
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
}

export interface ToolSchema {
  readonly type: "function";
  readonly function: { readonly name: string; readonly description: string; readonly parameters: Readonly<Record<string, unknown>> };
}

export type ParsedArguments =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

/** What a tool hands back to the model (as JSON) and to the transcript. */
export interface ToolResult {
  readonly exitCode: number | null;
  readonly accepted?: boolean;
  readonly recipe?: unknown;
  readonly output?: string;
  readonly error?: string;
  readonly ruleIds?: readonly string[];
  readonly pendingConfirmation?: readonly string[];
  readonly recipeHash?: string | null;
}
