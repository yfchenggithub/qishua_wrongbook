import Constants from 'expo-constants';

export const APP_NAME = '七刷错题本';

const configuredBuildDate = Constants.expoConfig?.extra?.buildDate;

export const APP_BUILD_DATE =
  typeof configuredBuildDate === 'string' && /^\d{2}\.\d{2}\.\d{2}$/.test(configuredBuildDate)
    ? configuredBuildDate
    : '未知';
export const APP_VERSION = APP_BUILD_DATE;
export const DATA_MODE_LABEL = '离线本地版';
export const OFFICIAL_ACCOUNT_SEARCH_TEXT = 'ok-shuxue';
export const SUPPORT_EMAIL = '18912964525@163.com';
export const IMAGE_COMBINER_URL = 'https://imagecombiner.com/';
