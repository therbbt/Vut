import type { VutCommand } from './types';
import { getPluginModule } from './plugins/pluginStore';

export interface MatchResult {
  command: VutCommand;
  /** Text to substitute into a `search` command's {query} placeholder. */
  query: string;
  /** True once the first token exactly equals this command's keyword. */
  exact: boolean;
}

const firstToken = (input: string): { token: string; rest: string; hasSpace: boolean } => {
  const spaceIndex = input.search(/\s/);
  if (spaceIndex === -1) return { token: input, rest: '', hasSpace: false };
  return { token: input.slice(0, spaceIndex), rest: input.slice(spaceIndex + 1).trimStart(), hasSpace: true };
};

/**
 * Filters and orders commands for the results list as the user types.
 * Empty input shows no results - just the search bar. Otherwise: an exact
 * keyword match always sorts first (so Enter/Tab act on it even while other
 * prefix matches are also showing), followed by keyword-prefix matches,
 * followed by title substring matches for discoverability.
 */
export const matchCommands = (input: string, commands: VutCommand[]): MatchResult[] => {
  if (input.length === 0) {
    return [];
  }

  const { token, rest, hasSpace } = firstToken(input);
  const lowerToken = token.toLowerCase();
  const lowerInput = input.toLowerCase();

  const exact: MatchResult[] = [];
  const prefix: MatchResult[] = [];
  const titleMatches: MatchResult[] = [];

  for (const command of commands) {
    const lowerKeyword = command.keyword.toLowerCase();
    const isExact = lowerKeyword === lowerToken;
    const query = isExact && hasSpace ? rest : '';

    if (isExact) {
      exact.push({ command, query, exact: true });
    } else if (lowerToken.length > 0 && lowerKeyword.startsWith(lowerToken)) {
      prefix.push({ command, query: '', exact: false });
    } else if (!hasSpace && command.title.toLowerCase().includes(lowerInput)) {
      titleMatches.push({ command, query: '', exact: false });
    }
  }

  return [...exact, ...prefix, ...titleMatches];
};

/** Resolves a `search` command's URL template against a query string. */
export const buildSearchUrl = (urlTemplate: string, query: string): string =>
  urlTemplate.replace('{query}', encodeURIComponent(query));

/** One-line description of what running this result will do, for display. */
export const describeAction = (result: MatchResult): string => {
  const { command, query } = result;
  switch (command.action.type) {
    case 'open_url':
      return command.action.url;
    case 'search':
      return query ? `Search for "${query}"` : buildSearchUrl(command.action.urlTemplate, '{query}');
    case 'launch_app':
      return command.action.kind === 'uri' ? command.action.uri : command.action.default.command;
    case 'open_settings':
      return 'Open the Vut settings window';
    case 'plugin': {
      const mod = getPluginModule(command.action.pluginId);
      const ctx = { config: command.action.fields, query };
      return mod?.describe?.(ctx) ?? (query || command.title);
    }
  }
};
