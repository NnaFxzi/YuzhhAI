import { Type } from '@sinclair/typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

import { isLobsterAiDesktopSessionKey } from './sessionKey';

type PluginConfig = {
  callbackUrl: string;
  secret: string;
  requestTimeoutMs: number;
};

type ToolRequest = {
  tool: string;
  args: Record<string, unknown>;
  context: {
    sessionKey: string;
    toolCallId: string;
  };
};

type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

const SaveReportSchema = Type.Object({
  packId: Type.String({
    description: 'Industry pack id. Use "heavy-packaging" for the bundled heavy packaging pack.',
  }),
  recommendedDirectionId: Type.String({
    description: 'Candidate id selected as the main promotion direction.',
  }),
  sourceSummary: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Structured research lane summaries.',
  }),
  candidates: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
    minItems: 1,
    description: 'Scored candidate direction reports.',
  }),
  backupDirectionIds: Type.Optional(Type.Array(Type.String(), {
    description: 'Backup candidate ids.',
  })),
  nextActions: Type.Optional(Type.Array(Type.String(), {
    description: 'Recommended next actions.',
  })),
  searchResultCount: Type.Optional(Type.Number({
    minimum: 0,
    description: 'Number of external search results used in the report.',
  })),
  extractedPageCount: Type.Optional(Type.Number({
    minimum: 0,
    description: 'Number of extracted pages used in the report.',
  })),
});

const GetLatestSchema = Type.Object({
  packId: Type.String({
    description: 'Industry pack id. Use "heavy-packaging" for the bundled heavy packaging pack.',
  }),
});

const ResearchProviderSchema = Type.Optional(Type.Union([
  Type.Literal('auto'),
  Type.Literal('tavily'),
  Type.Literal('firecrawl'),
]));

const SearchResearchSchema = Type.Object({
  query: Type.String({
    description: 'Search query for keyword, industry, competitor, or content research.',
  }),
  maxResults: Type.Optional(Type.Number({
    minimum: 1,
    maximum: 10,
    description: 'Maximum number of results to return.',
  })),
  provider: ResearchProviderSchema,
});

const ExtractResearchSchema = Type.Object({
  urls: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 10,
    description: 'URLs selected from external research results.',
  }),
  query: Type.Optional(Type.String({
    description: 'Optional extraction focus.',
  })),
  provider: ResearchProviderSchema,
});

const DomesticResearchSourcesSchema = Type.Object({});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parsePluginConfig = (value: unknown): PluginConfig => {
  const raw = isRecord(value) ? value : {};
  return {
    callbackUrl: typeof raw.callbackUrl === 'string' ? raw.callbackUrl.trim() : '',
    secret: typeof raw.secret === 'string' ? raw.secret.trim() : '',
    requestTimeoutMs:
      typeof raw.requestTimeoutMs === 'number' && Number.isFinite(raw.requestTimeoutMs)
        ? Math.max(1_000, Math.floor(raw.requestTimeoutMs))
        : DEFAULT_TIMEOUT_MS,
  };
};

async function callBridge(config: PluginConfig, request: ToolRequest): Promise<ToolResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lobster-industry-positioning-secret': config.secret,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Industry positioning callback HTTP ${response.status}: ${text.trim() || response.statusText}`);
    }
    if (!text.trim()) {
      return { content: [{ type: 'text', text: 'No response from LobsterAI.' }], isError: true };
    }

    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.content)) {
      return parsed as ToolResponse;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
      details: isRecord(parsed) ? parsed : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

const plugin = {
  id: 'lobster-industry-positioning',
  name: 'LobsterAI Industry Positioning',
  description: 'Save and read structured industry positioning reports from LobsterAI desktop.',
  configSchema: {
    parse(value: unknown): PluginConfig {
      return parsePluginConfig(value);
    },
  },
  register(api: OpenClawPluginApi) {
    const config = parsePluginConfig(api.pluginConfig);
    if (!config.callbackUrl || !config.secret) {
      api.logger.info('[lobster-industry-positioning] skipped: callbackUrl or secret not configured.');
      return;
    }

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!isLobsterAiDesktopSessionKey(sessionKey)) return null;

      return {
        name: 'lobsterai_industry_positioning_save',
        label: 'Save Industry Positioning Report',
        description: [
          'Save a structured product-positioning report after researching keywords, 1688 competitors, and content-platform pain points.',
          'Use after you have scored candidate product directions and selected the main promotion direction.',
        ].join(' '),
        parameters: SaveReportSchema,
        async execute(id: string, args: Record<string, unknown>) {
          try {
            return await callBridge(config, {
              tool: 'lobsterai_industry_positioning_save',
              args,
              context: { sessionKey, toolCallId: id },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text', text: message }], isError: true };
          }
        },
      };
    });

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!isLobsterAiDesktopSessionKey(sessionKey)) return null;

      return {
        name: 'lobsterai_industry_positioning_get_latest',
        label: 'Get Latest Industry Positioning Report',
        description: 'Read the latest saved product-positioning recommendation for an industry pack.',
        parameters: GetLatestSchema,
        async execute(id: string, args: Record<string, unknown>) {
          try {
            return await callBridge(config, {
              tool: 'lobsterai_industry_positioning_get_latest',
              args,
              context: { sessionKey, toolCallId: id },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text', text: message }], isError: true };
          }
        },
      };
    });

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!isLobsterAiDesktopSessionKey(sessionKey)) return null;

      return {
        name: 'lobsterai_external_research_search',
        label: 'External Research Search',
        description: [
          'Search external sources for industry, competitor, keyword, and customer pain-point research.',
          'API keys are resolved from LobsterAI visual agent settings; never ask the user for environment variables.',
        ].join(' '),
        parameters: SearchResearchSchema,
        async execute(id: string, args: Record<string, unknown>) {
          try {
            return await callBridge(config, {
              tool: 'lobsterai_external_research_search',
              args,
              context: { sessionKey, toolCallId: id },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text', text: message }], isError: true };
          }
        },
      };
    });

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!isLobsterAiDesktopSessionKey(sessionKey)) return null;

      return {
        name: 'lobsterai_external_research_extract',
        label: 'External Research Extract',
        description: [
          'Extract clean page content from URLs selected during external research.',
          'API keys are resolved from LobsterAI visual agent settings; never pass keys as tool arguments.',
        ].join(' '),
        parameters: ExtractResearchSchema,
        async execute(id: string, args: Record<string, unknown>) {
          try {
            return await callBridge(config, {
              tool: 'lobsterai_external_research_extract',
              args,
              context: { sessionKey, toolCallId: id },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text', text: message }], isError: true };
          }
        },
      };
    });

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!isLobsterAiDesktopSessionKey(sessionKey)) return null;

      return {
        name: 'lobsterai_domestic_research_sources_get',
        label: 'Get Domestic Research Sources',
        description: [
          'Read enabled domestic content-platform research sources for the current agent.',
          'Use this before product positioning analysis to know which platforms support search and which require pasted URLs.',
        ].join(' '),
        parameters: DomesticResearchSourcesSchema,
        async execute(id: string, args: Record<string, unknown>) {
          try {
            return await callBridge(config, {
              tool: 'lobsterai_domestic_research_sources_get',
              args,
              context: { sessionKey, toolCallId: id },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text', text: message }], isError: true };
          }
        },
      };
    });

    api.logger.info('[lobster-industry-positioning] registered industry positioning tools.');
  },
};

export default plugin;
