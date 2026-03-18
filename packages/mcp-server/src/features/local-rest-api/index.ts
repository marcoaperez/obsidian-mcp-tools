import { makeRequest, type ToolRegistry } from "$/shared";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { LocalRestAPI } from "shared";

export function registerLocalRestApiTools(tools: ToolRegistry, server: Server) {
  // GET Status
  tools.register(
    type({
      name: '"get_server_info"',
      arguments: "Record<string, unknown>",
    }).describe(
      "Returns basic details about the Obsidian Local REST API and authentication status. This is the only API request that does not require authentication.",
    ),
    async () => {
      const data = await makeRequest(LocalRestAPI.ApiStatusResponse, "/");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // GET Active File
  tools.register(
    type({
      name: '"get_active_file"',
      arguments: {
        format: type('"markdown" | "json"').optional(),
      },
    }).describe(
      "Returns the content of the currently active file in Obsidian. Can return either markdown content or a JSON representation including parsed tags and frontmatter.",
    ),
    async ({ arguments: args }) => {
      const format =
        args?.format === "json"
          ? "application/vnd.olrapi.note+json"
          : "text/markdown";
      const data = await makeRequest(
        LocalRestAPI.ApiNoteJson.or("string"),
        "/active/",
        {
          headers: { Accept: format },
        },
      );
      const content =
        typeof data === "string" ? data : JSON.stringify(data, null, 2);
      return { content: [{ type: "text", text: content }] };
    },
  );

  // PUT Active File
  tools.register(
    type({
      name: '"update_active_file"',
      arguments: {
        content: "string",
      },
    }).describe("Update the content of the active file open in Obsidian."),
    async ({ arguments: args }) => {
      await makeRequest(LocalRestAPI.ApiNoContentResponse, "/active/", {
        method: "PUT",
        body: args.content,
      });
      return {
        content: [{ type: "text", text: "File updated successfully" }],
      };
    },
  );

  // POST Active File
  tools.register(
    type({
      name: '"append_to_active_file"',
      arguments: {
        content: "string",
      },
    }).describe("Append content to the end of the currently-open note."),
    async ({ arguments: args }) => {
      await makeRequest(LocalRestAPI.ApiNoContentResponse, "/active/", {
        method: "POST",
        body: args.content,
      });
      return {
        content: [{ type: "text", text: "Content appended successfully" }],
      };
    },
  );

  // PATCH Active File
  tools.register(
    type({
      name: '"patch_active_file"',
      arguments: LocalRestAPI.ApiPatchParameters,
    }).describe(
      "Insert or modify content in the currently-open note relative to a heading, block reference, or frontmatter field.",
    ),
    async ({ arguments: args }) => {
      const headers: Record<string, string> = {
        Operation: args.operation,
        "Target-Type": args.targetType,
        Target: encodeURIComponent(args.target),
      };

      // Only create target if missing for append/prepend, not replace.
      // For replace, a missing target should return an error rather than
      // silently creating a duplicate heading.
      if (args.operation !== "replace") {
        headers["Create-Target-If-Missing"] = "true";
      }

      if (args.targetDelimiter) {
        headers["Target-Delimiter"] = encodeURIComponent(args.targetDelimiter);
      }
      if (args.trimTargetWhitespace !== undefined) {
        headers["Trim-Target-Whitespace"] = String(args.trimTargetWhitespace);
      }
      if (args.contentType) {
        headers["Content-Type"] = args.contentType;
      }

      // Ensure replace on headings ends with a trailing newline so the
      // next heading in the document remains properly separated.
      let body = args.content;
      if (args.operation === "replace" && args.targetType === "heading") {
        body = body.replace(/\n*$/, "\n\n");
      }

      try {
        const response = await makeRequest(
          LocalRestAPI.ApiContentResponse,
          "/active/",
          {
            method: "PATCH",
            headers,
            body,
          },
        );
        return {
          content: [
            { type: "text", text: "File patched successfully" },
            { type: "text", text: response },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("invalid-target")) {
          throw new McpError(
            ErrorCode.InternalError,
            `Could not find target "${args.target}" (type: ${args.targetType}, operation: ${args.operation}) in the active file. For headings, use the full path from the root heading delimited by '::' (e.g. 'Heading 1::Subheading'). Check that the heading text matches exactly, including any special characters.`,
          );
        }
        throw error;
      }
    },
  );

  // DELETE Active File
  tools.register(
    type({
      name: '"delete_active_file"',
      arguments: "Record<string, unknown>",
    }).describe("Delete the currently-active file in Obsidian."),
    async () => {
      await makeRequest(LocalRestAPI.ApiNoContentResponse, "/active/", {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: "File deleted successfully" }],
      };
    },
  );

  // POST Open File in Obsidian UI
  tools.register(
    type({
      name: '"show_file_in_obsidian"',
      arguments: {
        filename: "string",
        "newLeaf?": "boolean",
      },
    }).describe(
      "Open a document in the Obsidian UI. Creates a new document if it doesn't exist. Returns a confirmation if the file was opened successfully.",
    ),
    async ({ arguments: args }) => {
      const query = args.newLeaf ? "?newLeaf=true" : "";

      await makeRequest(
        LocalRestAPI.ApiNoContentResponse,
        `/open/${encodeURIComponent(args.filename)}${query}`,
        {
          method: "POST",
        },
      );

      return {
        content: [{ type: "text", text: "File opened successfully" }],
      };
    },
  );

  // POST Search via Dataview or JsonLogic
  tools.register(
    type({
      name: '"search_vault"',
      arguments: {
        query: "string",
        queryType: type('"dataview" | "jsonlogic"').describe(
          "Query language to use. 'dataview' for Dataview DQL queries, 'jsonlogic' for JsonLogic JSON queries.",
        ),
      },
    }).describe(
      "Search for documents matching a specified query using either Dataview DQL or JsonLogic.",
    ),
    async ({ arguments: args }) => {
      const contentType =
        args.queryType === "dataview"
          ? "application/vnd.olrapi.dataview.dql+txt"
          : "application/vnd.olrapi.jsonlogic+json";

      const data = await makeRequest(
        LocalRestAPI.ApiSearchResponse,
        "/search/",
        {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: args.query,
        },
      );

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // POST Simple Search
  tools.register(
    type({
      name: '"search_vault_simple"',
      arguments: {
        query: "string",
        "contextLength?": "number",
        "limit?": type("number").describe(
          "Maximum number of results to return. Helps prevent excessively large responses. Defaults to all results.",
        ),
      },
    }).describe("Search for documents matching a text query."),
    async ({ arguments: args }) => {
      const query = new URLSearchParams({
        query: args.query,
        ...(args.contextLength
          ? {
              contextLength: String(args.contextLength),
            }
          : {}),
      });

      const data = await makeRequest(
        LocalRestAPI.ApiSimpleSearchResponse,
        `/search/simple/?${query}`,
        {
          method: "POST",
        },
      );

      // Apply client-side limit to prevent excessively large responses
      const results = args.limit && Array.isArray(data)
        ? data.slice(0, args.limit)
        : data;

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  // GET Vault Files or Directories List
  tools.register(
    type({
      name: '"list_vault_files"',
      arguments: {
        "directory?": "string",
      },
    }).describe(
      "List files in the root directory or a specified subdirectory of your vault.",
    ),
    async ({ arguments: args }) => {
      const path = args.directory ? `${args.directory}/` : "";
      const data = await makeRequest(
        LocalRestAPI.ApiVaultFileResponse.or(
          LocalRestAPI.ApiVaultDirectoryResponse,
        ),
        `/vault/${path}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // GET Vault File Content
  tools.register(
    type({
      name: '"get_vault_file"',
      arguments: {
        filename: "string",
        "format?": type('"markdown" | "json"').describe(
          "Response format. 'markdown' returns raw file content. 'json' returns parsed note with frontmatter, tags, and file stats.",
        ),
        "frontmatterOnly?": type("boolean").describe(
          "When true and format is 'json', returns only frontmatter and tags without the full content. Useful for exploring metadata across many files without consuming excessive tokens.",
        ),
      },
    }).describe("Get the content of a file from your vault."),
    async ({ arguments: args }) => {
      const isJson = args.format === "json";
      const format = isJson
        ? "application/vnd.olrapi.note+json"
        : "text/markdown";
      const data = await makeRequest(
        isJson ? LocalRestAPI.ApiNoteJson : LocalRestAPI.ApiContentResponse,
        `/vault/${encodeURIComponent(args.filename)}`,
        {
          headers: { Accept: format },
        },
      );

      // Strip content when frontmatterOnly is requested
      if (args.frontmatterOnly && isJson && typeof data === "object" && data !== null) {
        const { content: _content, ...metadata } = data as Record<string, unknown>;
        return {
          content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              typeof data === "string" ? data : JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  // PUT Vault File Content
  tools.register(
    type({
      name: '"create_vault_file"',
      arguments: {
        filename: "string",
        content: "string",
      },
    }).describe("Create a new file in your vault or update an existing one."),
    async ({ arguments: args }) => {
      await makeRequest(
        LocalRestAPI.ApiNoContentResponse,
        `/vault/${encodeURIComponent(args.filename)}`,
        {
          method: "PUT",
          body: args.content,
        },
      );
      return {
        content: [{ type: "text", text: "File created successfully" }],
      };
    },
  );

  // POST Vault File Content
  tools.register(
    type({
      name: '"append_to_vault_file"',
      arguments: {
        filename: "string",
        content: "string",
      },
    }).describe("Append content to a new or existing file."),
    async ({ arguments: args }) => {
      await makeRequest(
        LocalRestAPI.ApiNoContentResponse,
        `/vault/${encodeURIComponent(args.filename)}`,
        {
          method: "POST",
          body: args.content,
        },
      );
      return {
        content: [{ type: "text", text: "Content appended successfully" }],
      };
    },
  );

  // PATCH Vault File Content
  tools.register(
    type({
      name: '"patch_vault_file"',
      arguments: type({
        filename: "string",
      }).and(LocalRestAPI.ApiPatchParameters),
    }).describe(
      "Insert or modify content in a file relative to a heading, block reference, or frontmatter field.",
    ),
    async ({ arguments: args }) => {
      const headers: HeadersInit = {
        Operation: args.operation,
        "Target-Type": args.targetType,
        Target: encodeURIComponent(args.target),
      };

      // Only create target if missing for append/prepend, not replace.
      // For replace, a missing target should return an error rather than
      // silently creating a duplicate heading.
      if (args.operation !== "replace") {
        headers["Create-Target-If-Missing"] = "true";
      }

      if (args.targetDelimiter) {
        headers["Target-Delimiter"] = encodeURIComponent(args.targetDelimiter);
      }
      if (args.trimTargetWhitespace !== undefined) {
        headers["Trim-Target-Whitespace"] = String(args.trimTargetWhitespace);
      }
      if (args.contentType) {
        headers["Content-Type"] = args.contentType;
      }

      // Ensure replace on headings ends with a trailing newline so the
      // next heading in the document remains properly separated.
      let body = args.content;
      if (args.operation === "replace" && args.targetType === "heading") {
        body = body.replace(/\n*$/, "\n\n");
      }

      try {
        const response = await makeRequest(
          LocalRestAPI.ApiContentResponse,
          `/vault/${encodeURIComponent(args.filename)}`,
          {
            method: "PATCH",
            headers,
            body,
          },
        );

        return {
          content: [
            { type: "text", text: "File patched successfully" },
            { type: "text", text: response },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("invalid-target")) {
          throw new McpError(
            ErrorCode.InternalError,
            `Could not find target "${args.target}" (type: ${args.targetType}, operation: ${args.operation}) in "${args.filename}". For headings, use the full path from the root heading delimited by '::' (e.g. 'Heading 1::Subheading'). Check that the heading text matches exactly, including any special characters.`,
          );
        }
        throw error;
      }
    },
  );

  // GET Recent Files via Dataview
  tools.register(
    type({
      name: '"get_recent_files"',
      arguments: {
        days: type("number").describe(
          "Number of days to look back. For example, 7 returns files modified in the last week.",
        ),
        "folder?": type("string").describe(
          "Limit results to a specific folder (e.g. 'Reuniones', 'Proyectos'). Omit to search the entire vault.",
        ),
        "limit?": type("number").describe(
          "Maximum number of results to return. Defaults to 50.",
        ),
      },
    }).describe(
      "Get recently modified files in the vault. Returns file name, modification date, creation date, tags, and folder. Useful for weekly reviews, activity summaries, and tracking recent changes.",
    ),
    async ({ arguments: args }) => {
      const folder = args.folder ? `"${args.folder}"` : '""';
      const limit = args.limit ?? 50;
      const query = `TABLE file.mtime AS "Modified", file.ctime AS "Created", file.tags AS "Tags", file.folder AS "Folder" FROM ${folder} WHERE file.mtime >= date(now) - dur(${args.days} days) SORT file.mtime DESC LIMIT ${limit}`;

      const data = await makeRequest(
        LocalRestAPI.ApiSearchResponse,
        "/search/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/vnd.olrapi.dataview.dql+txt",
          },
          body: query,
        },
      );

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // GET Multiple Vault Files (batch)
  tools.register(
    type({
      name: '"get_vault_files"',
      arguments: {
        filenames: type("string[]").describe(
          "Array of file paths to retrieve (e.g. ['Reuniones/2026-03-18.md', 'Proyectos/Plan.md']).",
        ),
        "format?": type('"markdown" | "json"').describe(
          "Response format for all files. 'markdown' returns raw content. 'json' returns parsed note with frontmatter, tags, and stats. Defaults to 'markdown'.",
        ),
        "frontmatterOnly?": type("boolean").describe(
          "When true and format is 'json', returns only metadata (frontmatter, tags, stats) without the full content body.",
        ),
      },
    }).describe(
      "Get the content of multiple files from your vault in a single call. Useful for reading several related notes at once (e.g. all meeting notes for a project, multiple research files for synthesis). Each file is returned as a separate result.",
    ),
    async ({ arguments: args }) => {
      const isJson = args.format === "json";
      const accept = isJson
        ? "application/vnd.olrapi.note+json"
        : "text/markdown";
      const responseType = isJson
        ? LocalRestAPI.ApiNoteJson
        : LocalRestAPI.ApiContentResponse;

      const results = await Promise.allSettled(
        args.filenames.map(async (filename) => {
          const data = await makeRequest(
            responseType,
            `/vault/${encodeURIComponent(filename)}`,
            { headers: { Accept: accept } },
          );
          return { filename, data };
        }),
      );

      const content = results.map((result, i) => {
        const filename = args.filenames[i];
        if (result.status === "rejected") {
          return {
            type: "text" as const,
            text: `--- ${filename} ---\nError: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          };
        }

        let text: string;
        const { data } = result.value;

        if (args.frontmatterOnly && isJson && typeof data === "object" && data !== null) {
          const { content: _content, ...metadata } = data as Record<string, unknown>;
          text = JSON.stringify(metadata, null, 2);
        } else {
          text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        }

        return {
          type: "text" as const,
          text: `--- ${filename} ---\n${text}`,
        };
      });

      return { content };
    },
  );

  // GET All Tags via Dataview
  tools.register(
    type({
      name: '"list_tags"',
      arguments: {
        "folder?": type("string").describe(
          "Limit to a specific folder. Omit to scan the entire vault.",
        ),
        "sort?": type('"name" | "count"').describe(
          "Sort by tag name or by usage count (descending). Defaults to 'count'.",
        ),
      },
    }).describe(
      "List all tags used across the vault with their usage count. Useful for discovering content categories, finding related notes, and understanding vault organization.",
    ),
    async ({ arguments: args }) => {
      const folder = args.folder ? `"${args.folder}"` : '""';
      // Dataview query to collect all tags with file counts
      const query = `TABLE WITHOUT ID file.tags AS "Tags" FROM ${folder} WHERE file.tags FLATTEN file.tags AS tag`;

      try {
        const data = await makeRequest(
          LocalRestAPI.ApiSearchResponse,
          "/search/",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/vnd.olrapi.dataview.dql+txt",
            },
            body: `TABLE file.tags AS "Tags" FROM ${folder} WHERE length(file.tags) > 0`,
          },
        );

        // Aggregate tag counts from Dataview results
        const tagCounts: Record<string, number> = {};
        for (const entry of data) {
          const result = entry.result as Record<string, unknown>;
          const tags = result?.Tags;
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              const tagStr = String(tag);
              tagCounts[tagStr] = (tagCounts[tagStr] || 0) + 1;
            }
          }
        }

        // Sort by count (default) or name
        const sorted = Object.entries(tagCounts).sort((a, b) =>
          args.sort === "name"
            ? a[0].localeCompare(b[0])
            : b[1] - a[1],
        );

        const output = {
          totalTags: sorted.length,
          tags: sorted.map(([tag, count]) => ({ tag, count })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to list tags: ${message}. Ensure the Dataview plugin is installed and enabled.`,
        );
      }
    },
  );

  // GET Document Map (headings, blocks, frontmatter fields)
  tools.register(
    type({
      name: '"get_document_map"',
      arguments: {
        filename: type("string").describe(
          "Path to the file (relative to vault root).",
        ),
      },
    }).describe(
      "Get the structure of a document: all headings (with full paths), block references, and frontmatter field names. Use this before patch operations to discover valid targets. Returns the exact target strings needed for patch_vault_file.",
    ),
    async ({ arguments: args }) => {
      const data = await makeRequest(
        type({
          headings: "string[]",
          blocks: "string[]",
          frontmatterFields: "string[]",
        }),
        `/vault/${encodeURIComponent(args.filename)}`,
        {
          headers: {
            Accept: "application/vnd.olrapi.document-map+json",
          },
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // GET Periodic Note
  tools.register(
    type({
      name: '"get_periodic_note"',
      arguments: {
        period: type('"daily" | "weekly" | "monthly" | "quarterly" | "yearly"').describe(
          "The period type of the note to retrieve.",
        ),
        "year?": type("number").describe("Year (e.g. 2026). Omit to get the current period's note."),
        "month?": type("number").describe("Month (1-12). Required with year for daily/weekly/monthly notes."),
        "day?": type("number").describe("Day (1-31). Required with year and month for daily/weekly notes."),
        "format?": type('"markdown" | "json"').describe(
          "Response format. 'markdown' returns raw content. 'json' returns parsed note with frontmatter, tags, and stats.",
        ),
      },
    }).describe(
      "Get a periodic note (daily, weekly, monthly, quarterly, or yearly). Without date parameters, returns the current period's note. With date parameters, returns the note for that specific date. Requires the Periodic Notes plugin.",
    ),
    async ({ arguments: args }) => {
      const datePart =
        args.year !== undefined
          ? `/${args.year}/${args.month ?? 1}/${args.day ?? 1}`
          : "";
      const path = `/periodic/${args.period}${datePart}/`;
      const isJson = args.format === "json";
      const accept = isJson
        ? "application/vnd.olrapi.note+json"
        : "text/markdown";

      const data = await makeRequest(
        isJson ? LocalRestAPI.ApiNoteJson : LocalRestAPI.ApiContentResponse,
        path,
        { headers: { Accept: accept } },
      );

      return {
        content: [
          {
            type: "text",
            text:
              typeof data === "string" ? data : JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  // POST Append to Periodic Note
  tools.register(
    type({
      name: '"append_to_periodic_note"',
      arguments: {
        period: type('"daily" | "weekly" | "monthly" | "quarterly" | "yearly"').describe(
          "The period type of the note.",
        ),
        content: type("string").describe("Content to append to the periodic note."),
        "year?": type("number").describe("Year (e.g. 2026). Omit for the current period."),
        "month?": type("number").describe("Month (1-12)."),
        "day?": type("number").describe("Day (1-31)."),
      },
    }).describe(
      "Append content to a periodic note. Creates the note if it doesn't exist. Without date parameters, appends to the current period's note. Requires the Periodic Notes plugin.",
    ),
    async ({ arguments: args }) => {
      const datePart =
        args.year !== undefined
          ? `/${args.year}/${args.month ?? 1}/${args.day ?? 1}`
          : "";
      const path = `/periodic/${args.period}${datePart}/`;

      await makeRequest(LocalRestAPI.ApiNoContentResponse, path, {
        method: "POST",
        body: args.content,
      });

      return {
        content: [{ type: "text", text: "Content appended to periodic note successfully" }],
      };
    },
  );

  // PATCH Periodic Note
  tools.register(
    type({
      name: '"patch_periodic_note"',
      arguments: type({
        period: type('"daily" | "weekly" | "monthly" | "quarterly" | "yearly"').describe(
          "The period type of the note.",
        ),
        "year?": type("number").describe("Year (e.g. 2026). Omit for the current period."),
        "month?": type("number").describe("Month (1-12)."),
        "day?": type("number").describe("Day (1-31)."),
      }).and(LocalRestAPI.ApiPatchParameters),
    }).describe(
      "Insert or modify content in a periodic note relative to a heading, block reference, or frontmatter field. Requires the Periodic Notes plugin.",
    ),
    async ({ arguments: args }) => {
      const datePart =
        args.year !== undefined
          ? `/${args.year}/${args.month ?? 1}/${args.day ?? 1}`
          : "";
      const path = `/periodic/${args.period}${datePart}/`;

      const headers: Record<string, string> = {
        Operation: args.operation,
        "Target-Type": args.targetType,
        Target: encodeURIComponent(args.target),
      };

      if (args.operation !== "replace") {
        headers["Create-Target-If-Missing"] = "true";
      }
      if (args.targetDelimiter) {
        headers["Target-Delimiter"] = encodeURIComponent(args.targetDelimiter);
      }
      if (args.trimTargetWhitespace !== undefined) {
        headers["Trim-Target-Whitespace"] = String(args.trimTargetWhitespace);
      }
      if (args.contentType) {
        headers["Content-Type"] = args.contentType;
      }

      let body = args.content;
      if (args.operation === "replace" && args.targetType === "heading") {
        body = body.replace(/\n*$/, "\n\n");
      }

      try {
        const response = await makeRequest(
          LocalRestAPI.ApiContentResponse,
          path,
          { method: "PATCH", headers, body },
        );
        return {
          content: [
            { type: "text", text: "Periodic note patched successfully" },
            { type: "text", text: response },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("invalid-target")) {
          throw new McpError(
            ErrorCode.InternalError,
            `Could not find target "${args.target}" (type: ${args.targetType}, operation: ${args.operation}) in periodic note. For headings, use the full path delimited by '::'.`,
          );
        }
        throw error;
      }
    },
  );

  // GET Commands List
  tools.register(
    type({
      name: '"list_commands"',
      arguments: "Record<string, unknown>",
    }).describe(
      "List all available Obsidian commands. Returns command IDs and names. Use with execute_command to run any command.",
    ),
    async () => {
      const data = await makeRequest(
        LocalRestAPI.ApiCommandsResponse,
        "/commands/",
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // POST Execute Command
  tools.register(
    type({
      name: '"execute_command"',
      arguments: {
        commandId: type("string").describe(
          "The ID of the command to execute (e.g. 'global-search:open', 'graph:open'). Use list_commands to discover available IDs.",
        ),
      },
    }).describe(
      "Execute an Obsidian command by its ID. Can trigger any command available in the command palette: open graph view, toggle sidebar, sync, export, etc. Use list_commands first to discover available command IDs.",
    ),
    async ({ arguments: args }) => {
      await makeRequest(
        LocalRestAPI.ApiNoContentResponse,
        `/commands/${encodeURIComponent(args.commandId)}/`,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: `Command "${args.commandId}" executed successfully` }],
      };
    },
  );

  // DELETE Vault File Content
  tools.register(
    type({
      name: '"delete_vault_file"',
      arguments: {
        filename: "string",
      },
    }).describe("Delete a file from your vault."),
    async ({ arguments: args }) => {
      await makeRequest(
        LocalRestAPI.ApiNoContentResponse,
        `/vault/${encodeURIComponent(args.filename)}`,
        {
          method: "DELETE",
        },
      );
      return {
        content: [{ type: "text", text: "File deleted successfully" }],
      };
    },
  );
}
