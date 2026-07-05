export function cleanModelJsonText(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstObjectBrace = trimmed.indexOf('{');
  const lastObjectBrace = trimmed.lastIndexOf('}');
  if (firstObjectBrace !== -1 && lastObjectBrace > firstObjectBrace) {
    return trimmed.slice(firstObjectBrace, lastObjectBrace + 1).trim();
  }

  return trimmed;
}

export function parseModelJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanModelJsonText(text)) as unknown;
  } catch (error) {
    throw new Error('Enterprise lead model response was not valid JSON', { cause: error });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Enterprise lead model response must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}
