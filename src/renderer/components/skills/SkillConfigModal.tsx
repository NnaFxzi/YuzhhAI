import { EyeIcon, EyeSlashIcon } from '@heroicons/react/20/solid';
import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { type SkillConfigField, SkillConfigFieldType } from '@shared/skills/config';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { Skill } from '../../types/skill';
import Modal from '../common/Modal';
import ErrorMessage from '../ErrorMessage';
import {
  buildSkillConfigDraft,
  getMissingRequiredSkillConfigFields,
  resolveSkillConfigText,
} from './skillConfigEditor';

interface SkillConfigModalProps {
  skill: Skill;
  onClose: () => void;
  onSaved?: (skillId: string, config: Record<string, string>) => void;
}

const getFieldInputType = (
  field: SkillConfigField,
  isSecretVisible: boolean,
): React.HTMLInputTypeAttribute => {
  if (field.type === SkillConfigFieldType.Secret) {
    return isSecretVisible ? 'text' : 'password';
  }
  if (field.type === SkillConfigFieldType.Url) {
    return 'url';
  }
  return 'text';
};

const SkillConfigModal: React.FC<SkillConfigModalProps> = ({ skill, onClose, onSaved }) => {
  const schema = skill.configSchema;
  const helpUrl = schema?.helpUrl;
  const language = i18nService.getLanguage() === 'zh' ? 'zh' : 'en';
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [visibleSecretKeys, setVisibleSecretKeys] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const fields = useMemo(() => schema?.fields ?? [], [schema]);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError('');
    void skillService
      .getSkillConfig(skill.id)
      .then(config => {
        if (!isActive) return;
        setDraft(buildSkillConfigDraft(schema, config));
      })
      .catch(() => {
        if (!isActive) return;
        setError(i18nService.t('skillConfigLoadFailed'));
        setDraft(buildSkillConfigDraft(schema, {}));
      })
      .finally(() => {
        if (!isActive) return;
        setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [schema, skill.id]);

  const updateField = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const toggleSecretVisibility = (key: string) => {
    setVisibleSecretKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    const missingKeys = getMissingRequiredSkillConfigFields(schema, draft);
    if (missingKeys.length > 0) {
      setError(i18nService.t('skillConfigRequiredError').replace('{keys}', missingKeys.join(', ')));
      return;
    }

    setIsSaving(true);
    setError('');
    const success = await skillService.setSkillConfig(skill.id, draft);
    setIsSaving(false);
    if (!success) {
      setError(i18nService.t('skillConfigSaveFailed'));
      return;
    }
    onSaved?.(skill.id, draft);
    window.dispatchEvent(
      new CustomEvent('app:showToast', { detail: i18nService.t('skillConfigSaved') }),
    );
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      className="mx-4 flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">
            {i18nService.t('skillConfigTitle').replace('{name}', skill.name)}
          </h2>
          <p className="mt-1 text-sm leading-5 text-secondary">
            {i18nService.t('skillConfigDesc')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-4">
            <ErrorMessage message={error} onClose={() => setError('')} />
          </div>
        )}

        {isLoading ? (
          <div className="rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-secondary">
            {i18nService.t('loading')}
          </div>
        ) : (
          <div className="space-y-4">
            {fields.map(field => {
              const label = resolveSkillConfigText(field.label, language) || field.key;
              const description = resolveSkillConfigText(field.description, language);
              const placeholder = resolveSkillConfigText(field.placeholder, language);
              const isSecret = field.type === SkillConfigFieldType.Secret;
              const isSecretVisible = visibleSecretKeys.has(field.key);
              return (
                <label key={field.key} className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className="text-[11px] text-secondary">
                      {field.required
                        ? i18nService.t('skillConfigRequired')
                        : i18nService.t('skillConfigOptional')}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type={getFieldInputType(field, isSecretVisible)}
                      value={draft[field.key] ?? ''}
                      placeholder={placeholder || field.key}
                      onChange={event => updateField(field.key, event.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 pr-12 text-sm text-foreground placeholder-secondary focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {isSecret && (
                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility(field.key)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                        title={i18nService.t(
                          isSecretVisible ? 'skillConfigSecretHide' : 'skillConfigSecretShow',
                        )}
                      >
                        {isSecretVisible ? (
                          <EyeSlashIcon className="h-4 w-4" />
                        ) : (
                          <EyeIcon className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                  {description && (
                    <p className="mt-1.5 text-xs leading-5 text-secondary">{description}</p>
                  )}
                </label>
              );
            })}

            {helpUrl && (
              <button
                type="button"
                onClick={() => window.electron.shell.openExternal(helpUrl)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                {i18nService.t('skillConfigOpenHelp')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
        >
          {i18nService.t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || isLoading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {isSaving ? i18nService.t('saving') : i18nService.t('save')}
        </button>
      </div>
    </Modal>
  );
};

export default SkillConfigModal;
