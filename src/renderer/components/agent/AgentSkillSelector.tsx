import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import type { Skill } from '../../types/skill';
import SearchIcon from '../icons/SearchIcon';
import SkillIcon from '../icons/SkillIcon';
import { AgentSkillFilter, filterAgentSkills } from './agentSkillSelectorUi';

interface AgentSkillSelectorProps {
  selectedSkillIds: string[];
  onChange: (skillIds: string[]) => void;
  readOnly?: boolean;
  initialFilter?: AgentSkillFilter;
}

const AgentSkillSelector: React.FC<AgentSkillSelectorProps> = ({
  selectedSkillIds,
  onChange,
  readOnly = false,
  initialFilter = AgentSkillFilter.All,
}) => {
  const skills = useSelector((state: RootState) => state.skill.skills);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AgentSkillFilter>(initialFilter);
  const [, setI18nReady] = useState(() => skillService.hasLocalizedSkillDescriptions());

  // Load localized skill descriptions from marketplace API
  useEffect(() => {
    let isMounted = true;
    const markReady = () => {
      if (isMounted) {
        setI18nReady(true);
      }
    };

    if (skillService.hasLocalizedSkillDescriptions()) {
      markReady();
      return () => {
        isMounted = false;
      };
    }
    skillService.fetchMarketplaceSkills().then(markReady).catch(markReady);

    return () => {
      isMounted = false;
    };
  }, []);

  const enabledSkills = useMemo(() => skills.filter(s => s.enabled), [skills]);

  const getDescription = useCallback(
    (skill: Skill) =>
      skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description),
    [],
  );

  const filteredSkills = useMemo(
    () =>
      filterAgentSkills({
        skills: enabledSkills,
        selectedSkillIds,
        filter,
        query: search,
        getDescription,
      }),
    [enabledSkills, selectedSkillIds, filter, search, getDescription],
  );

  const selectedSkillChips = useMemo(
    () =>
      selectedSkillIds.map(id => {
        const skill = skills.find(item => item.id === id);
        return {
          id,
          label: skill?.name || id,
        };
      }),
    [skills, selectedSkillIds],
  );

  const toggle = (skillId: string) => {
    if (readOnly) return;
    if (selectedSkillIds.includes(skillId)) {
      onChange(selectedSkillIds.filter(id => id !== skillId));
    } else {
      onChange([...selectedSkillIds, skillId]);
    }
  };

  const getSkillBadge = (skill: Skill): string => {
    if (skill.isBuiltIn) return i18nService.t('agentSkillBuiltInBadge');
    if (skill.isOfficial) return i18nService.t('agentSkillOfficialBadge');
    return i18nService.t('agentSkillCustomBadge');
  };

  const selectionText =
    selectedSkillIds.length === 0
      ? i18nService.t('agentSkillsSelectionAll')
      : i18nService
          .t('agentSkillsSelectionCount')
          .replace('{count}', String(selectedSkillIds.length));

  const filterOptions = [
    [AgentSkillFilter.All, 'agentSkillsFilterAll'],
    [AgentSkillFilter.Selected, 'agentSkillsFilterSelected'],
    [AgentSkillFilter.Recommended, 'agentSkillsFilterRecommended'],
    [AgentSkillFilter.BuiltIn, 'agentSkillsFilterBuiltIn'],
    [AgentSkillFilter.Custom, 'agentSkillsFilterCustom'],
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 rounded-lg border border-border bg-surface-raised/40 px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{selectionText}</div>
            <div className="mt-1 text-xs leading-5 text-secondary">
              {i18nService.t('agentSkillsHint')}
            </div>
          </div>
          {selectedSkillIds.length > 0 && !readOnly && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              {i18nService.t('agentSkillsClearSelection')}
            </button>
          )}
        </div>
        <div className="mt-3 border-t border-border-subtle pt-3">
          <div className="mb-2 text-xs font-semibold text-foreground">
            {i18nService.t('agentSkillsSelectedTitle')}
          </div>
          {selectedSkillChips.length === 0 ? (
            <div className="text-xs leading-5 text-secondary">
              {i18nService.t('agentSkillsSelectedEmpty')}
            </div>
          ) : (
            <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
              {selectedSkillChips.map(skill => (
                <button
                  key={skill.id}
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggle(skill.id)}
                  aria-label={i18nService
                    .t('agentSkillsRemoveSkill')
                    .replace('{skill}', skill.label)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/15 disabled:cursor-default disabled:hover:border-primary/25 disabled:hover:bg-primary/10"
                >
                  <span className="truncate">{skill.label}</span>
                  {!readOnly && <XMarkIcon className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary/45" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={i18nService.t('agentSkillsSearch')}
            aria-label={i18nService.t('agentSkillsSearch')}
            className="h-9 w-full rounded-md border border-border-subtle bg-surface-raised/30 pl-9 pr-3 text-xs text-foreground placeholder:text-secondary/45 focus:border-border focus:bg-surface focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {filterOptions.map(([option, labelKey]) => {
            const isActive = filter === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                aria-pressed={isActive}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border-subtle bg-surface text-secondary hover:border-border hover:bg-surface-raised hover:text-foreground'
                }`}
              >
                {i18nService.t(labelKey)}
              </button>
            );
          })}
        </div>
        {filter === AgentSkillFilter.Recommended && (
          <div className="mt-2 text-xs leading-5 text-secondary">
            {i18nService.t('agentSkillsRecommendedHint')}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filteredSkills.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-secondary/60">
            {enabledSkills.length === 0
              ? i18nService.t('agentSkillsNoInstalled')
              : i18nService.t('agentSkillsNoMatches')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-foreground">
              {i18nService.t('agentSkillsAvailableTitle')}
            </div>
            {filteredSkills.map(skill => {
              const isSelected = selectedSkillIds.includes(skill.id);
              const description = getDescription(skill);

              return (
                <button
                  key={skill.id}
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggle(skill.id)}
                  aria-pressed={isSelected}
                  className={`group flex min-h-[72px] w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-surface-raised/60 disabled:cursor-default disabled:hover:bg-surface disabled:hover:border-border ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border bg-surface'
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised">
                    <SkillIcon className="h-[18px] w-[18px] text-secondary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold leading-5 text-foreground">
                        {skill.name}
                      </div>
                      <span className="rounded-md bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium leading-4 text-secondary">
                        {getSkillBadge(skill)}
                      </span>
                    </div>
                    {description && (
                      <div className="mt-1 line-clamp-2 text-xs leading-[18px] text-secondary/85">
                        {description}
                      </div>
                    )}
                  </div>
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary'
                        : 'border-border bg-surface group-hover:border-primary/50'
                    }`}
                  >
                    {isSelected && <CheckIcon className="h-3.5 w-3.5 text-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentSkillSelector;
