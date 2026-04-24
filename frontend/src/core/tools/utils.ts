import type { ToolCall } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/langgraph-sdk";

import type { Translations } from "../i18n";
import { hasToolCalls } from "../messages/utils";

export function explainLastToolCall(message: AIMessage, t: Translations) {
  if (hasToolCalls(message)) {
    const lastToolCall = message.tool_calls![message.tool_calls!.length - 1]!;
    return explainToolCall(lastToolCall, t);
  }
  return t.common.thinking;
}

export function explainToolCall(toolCall: ToolCall, t: Translations) {
  const args =
    typeof toolCall.args === "object" && toolCall.args !== null
      ? (toolCall.args as Record<string, unknown>)
      : {};
  const description =
    typeof args.description === "string" ? args.description : null;

  if (toolCall.name === "web_search" || toolCall.name === "image_search") {
    return typeof args.query === "string"
      ? t.toolCalls.searchFor(args.query)
      : t.toolCalls.searchForRelatedInfo;
  } else if (toolCall.name === "web_fetch") {
    return t.toolCalls.viewWebPage;
  } else if (toolCall.name === "bash") {
    return description ?? t.toolCalls.executeCommand;
  } else if (toolCall.name === "ls") {
    return description ?? t.toolCalls.listFolder;
  } else if (toolCall.name === "read_file") {
    return description ?? t.toolCalls.readFile;
  } else if (
    toolCall.name === "write_file" ||
    toolCall.name === "str_replace"
  ) {
    return description ?? t.toolCalls.writeFile;
  } else if (toolCall.name === "semantic_search") {
    return typeof args.query === "string"
      ? t.toolCalls.searchFor(args.query)
      : t.toolCalls.searchForRelatedInfo;
  } else if (toolCall.name === "view_image") {
    return description ?? t.toolCalls.useTool("view_image");
  } else if (toolCall.name === "task") {
    return description ?? t.toolCalls.useTool("task");
  } else if (toolCall.name === "present_files") {
    return t.toolCalls.presentFiles;
  } else if (toolCall.name === "ask_clarification") {
    return t.toolCalls.needYourHelp;
  } else if (toolCall.name === "write_todos") {
    return t.toolCalls.writeTodos;
  } else if (description) {
    return description;
  } else {
    return t.toolCalls.useTool(toolCall.name);
  }
}
