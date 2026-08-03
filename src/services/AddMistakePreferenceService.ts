import AsyncStorage from 'expo-sqlite/kv-store';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'AddMistakePreferenceService';
const LAST_SELECTED_MODULE_ID_KEY = 'add-mistake:last-selected-module-id:v1';

function normalizeModuleId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export async function loadLastSelectedModuleId(): Promise<string | null> {
  try {
    return normalizeModuleId(await AsyncStorage.getItem(LAST_SELECTED_MODULE_ID_KEY));
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load the last selected module.', { error });
    return null;
  }
}

export async function saveLastSelectedModuleId(moduleId: string): Promise<void> {
  const normalizedModuleId = normalizeModuleId(moduleId);
  if (!normalizedModuleId) return;

  try {
    await AsyncStorage.setItem(LAST_SELECTED_MODULE_ID_KEY, normalizedModuleId);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to save the last selected module.', { error });
  }
}
