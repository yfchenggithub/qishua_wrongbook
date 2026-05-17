import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'DeveloperModeService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const DEVELOPER_MODE_FILE_NAME = 'developer_mode_state.json';

type DeveloperModeState = {
  enabled: boolean;
  updatedAt: string;
};

function getSettingsDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, SETTINGS_DIR_NAME);
}

function getDeveloperModeStateFile(): File {
  return new File(getSettingsDirectory(), DEVELOPER_MODE_FILE_NAME);
}

function toSafeUriPreview(uri: string): string {
  if (uri.length <= 72) {
    return uri;
  }
  return `${uri.slice(0, 30)}...${uri.slice(-20)}`;
}

export async function loadDeveloperModeEnabled(): Promise<boolean> {
  try {
    const stateFile = getDeveloperModeStateFile();
    if (!stateFile.exists) {
      return false;
    }

    const rawContent = await stateFile.text();
    const parsed = JSON.parse(rawContent) as Partial<DeveloperModeState> | null;
    return parsed?.enabled === true;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load developer mode state, fallback to disabled.', {
      error,
    });
    return false;
  }
}

export async function saveDeveloperModeEnabled(enabled: boolean): Promise<void> {
  try {
    const directory = getSettingsDirectory();
    directory.create({ intermediates: true, idempotent: true });

    const stateFile = getDeveloperModeStateFile();
    const state: DeveloperModeState = {
      enabled,
      updatedAt: new Date().toISOString(),
    };

    stateFile.write(JSON.stringify(state));
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to save developer mode state.', {
      enabled,
      fileUri: toSafeUriPreview(getDeveloperModeStateFile().uri),
      error,
    });
    throw error;
  }
}
