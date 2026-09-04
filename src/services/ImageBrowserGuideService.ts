import AsyncStorage from 'expo-sqlite/kv-store';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImageBrowserGuideService';
const IMAGE_BROWSER_GESTURE_GUIDE_SEEN_KEY = 'mistake-image-browser:gesture-guide-seen:v1';

export async function shouldShowImageBrowserGestureGuide(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(IMAGE_BROWSER_GESTURE_GUIDE_SEEN_KEY)) !== '1';
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load the image browser gesture guide preference.', { error });
    return false;
  }
}

export async function markImageBrowserGestureGuideSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(IMAGE_BROWSER_GESTURE_GUIDE_SEEN_KEY, '1');
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to save the image browser gesture guide preference.', { error });
  }
}

export async function resetImageBrowserGestureGuide(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(IMAGE_BROWSER_GESTURE_GUIDE_SEEN_KEY);
    return true;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to reset the image browser gesture guide preference.', { error });
    return false;
  }
}
