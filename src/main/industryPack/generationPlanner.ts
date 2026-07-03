import type { IndustryGenerationRequest } from '../../shared/industryPack/types';
import { normalizeGenerationRequest } from '../../shared/industryPack/validation';

export interface PlannedGenerationItem {
  day: number;
  channel: string;
  theme: string;
}

const DEFAULT_THEME_ID = 'case_story';

function getRequestedDayCount(request: IndustryGenerationRequest): number {
  return Math.max(1, Math.floor(request.period.days || 1));
}

function getThemeForItem(themes: string[], day: number, channelIndex: number): string {
  if (themes.length === 0) return DEFAULT_THEME_ID;

  return themes[(day + channelIndex - 1) % themes.length] ?? themes[0] ?? DEFAULT_THEME_ID;
}

export function planGenerationItems(request: IndustryGenerationRequest): PlannedGenerationItem[] {
  const normalizedRequest = normalizeGenerationRequest(request);
  const totalDays = getRequestedDayCount(normalizedRequest);
  const items: PlannedGenerationItem[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    normalizedRequest.channels.forEach((channel, channelIndex) => {
      items.push({
        day,
        channel: String(channel),
        theme: getThemeForItem(normalizedRequest.themes, day, channelIndex),
      });
    });
  }

  return items;
}
