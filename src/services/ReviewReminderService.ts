import { Linking, Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';

import { Logger } from '@/src/services/Logger';
import * as MistakeListService from '@/src/services/MistakeListService';
import { addDays, startOfLocalDay, toDateOnlyString } from '@/src/utils/date';

const SERVICE_SCOPE = 'ReviewReminderService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const SETTINGS_FILE_NAME = 'review_reminder_settings.json';
const CHANNEL_ID = 'review-reminder';
const LOOKAHEAD_DAYS = 30;
const REMINDER_TYPE = 'review-reminder';

export type ReviewReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
  notificationId?: string | null;
  scheduledDate?: string | null;
  lastReminderDate?: string | null;
  updatedAt: string;
};

export type ReminderScheduleRefreshResult = {
  settings: ReviewReminderSettings;
  hasPermission: boolean;
  pendingTodayCount: number;
  scheduled: boolean;
};

const DEFAULT_SETTINGS: ReviewReminderSettings = {
  enabled: false,
  hour: 20,
  minute: 0,
  notificationId: null,
  scheduledDate: null,
  lastReminderDate: null,
  updatedAt: new Date(0).toISOString(),
};

function getSettingsDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, SETTINGS_DIR_NAME);
}

function getSettingsFile(): File {
  return new File(getSettingsDirectory(), SETTINGS_FILE_NAME);
}

function clampHour(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.hour;
  }
  return Math.min(23, Math.max(0, Math.floor(value)));
}

function clampMinute(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.minute;
  }
  return Math.min(59, Math.max(0, Math.floor(value)));
}

function normalizeDateKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  return matched ? trimmed : null;
}

function normalizeSettings(input: Partial<ReviewReminderSettings> | null | undefined): ReviewReminderSettings {
  const nowIso = new Date().toISOString();
  const source = input ?? {};
  const enabled = source.enabled === true;
  const hour = clampHour(source.hour ?? DEFAULT_SETTINGS.hour);
  const minute = clampMinute(source.minute ?? DEFAULT_SETTINGS.minute);
  const notificationId =
    typeof source.notificationId === 'string' && source.notificationId.trim().length > 0
      ? source.notificationId.trim()
      : null;
  const scheduledDate =
    typeof source.scheduledDate === 'string' && source.scheduledDate.trim().length > 0
      ? source.scheduledDate.trim()
      : null;
  const lastReminderDate = normalizeDateKey(source.lastReminderDate ?? null);
  const updatedAt =
    typeof source.updatedAt === 'string' && source.updatedAt.trim().length > 0
      ? source.updatedAt
      : nowIso;

  return {
    enabled,
    hour,
    minute,
    notificationId,
    scheduledDate,
    lastReminderDate,
    updatedAt,
  };
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isSameScheduleDateTime(leftIso: string | null | undefined, rightIso: string): boolean {
  const left = parseIsoDate(leftIso);
  const right = parseIsoDate(rightIso);
  if (!left || !right) {
    return false;
  }
  return left.getTime() === right.getTime();
}

function buildReminderTime(baseDate: Date, hour: number, minute: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function buildNotificationData(reminderDate: Date): Record<string, unknown> {
  return {
    type: REMINDER_TYPE,
    reminderDateKey: toDateOnlyString(reminderDate),
    scheduledDate: reminderDate.toISOString(),
  };
}

async function readPersistedSettings(): Promise<ReviewReminderSettings> {
  try {
    const settingsFile = getSettingsFile();
    if (!settingsFile.exists) {
      return { ...DEFAULT_SETTINGS };
    }
    const raw = await settingsFile.text();
    const parsed = JSON.parse(raw) as Partial<ReviewReminderSettings> | null;
    return normalizeSettings(parsed);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to read reminder settings, fallback to defaults.', { error });
    return { ...DEFAULT_SETTINGS };
  }
}

async function writePersistedSettings(settings: ReviewReminderSettings): Promise<void> {
  const directory = getSettingsDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const settingsFile = getSettingsFile();
  settingsFile.write(JSON.stringify(settings));
}

function isPermissionGranted(status: Notifications.NotificationPermissionsStatus): boolean {
  if (status.granted) {
    return true;
  }
  return status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

async function findNextReminderDate(
  settings: ReviewReminderSettings,
  now: Date,
): Promise<Date | null> {
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset += 1) {
    const day = addDays(startOfLocalDay(now), offset);
    const dayKey = toDateOnlyString(day);
    if (settings.lastReminderDate === dayKey) {
      continue;
    }

    const reminderTime = buildReminderTime(day, settings.hour, settings.minute);
    if (reminderTime.getTime() <= now.getTime()) {
      continue;
    }

    const pendingCount = await MistakeListService.getPendingReviewCountByDate(day);
    if (pendingCount > 0) {
      return reminderTime;
    }
  }

  return null;
}

async function scheduleOneShotReminder(date: Date): Promise<string> {
  const trigger: Notifications.DateTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date,
    channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
  };

  return Notifications.scheduleNotificationAsync({
    content: {
      title: '该复做啦',
      body: '今天还有错题待复做，花几分钟完成今日复做吧。',
      sound: true,
      data: buildNotificationData(date),
    },
    trigger,
  });
}

async function clearReminderScheduleFields(
  settings: ReviewReminderSettings,
  options?: { keepUpdatedAt?: boolean },
): Promise<ReviewReminderSettings> {
  if (settings.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(settings.notificationId).catch((error) => {
      Logger.warn(SERVICE_SCOPE, 'Cancel scheduled reminder failed.', {
        notificationId: settings.notificationId,
        error,
      });
    });
  }

  const next = normalizeSettings({
    ...settings,
    notificationId: null,
    scheduledDate: null,
    updatedAt: options?.keepUpdatedAt ? settings.updatedAt : new Date().toISOString(),
  });
  await writePersistedSettings(next);
  return next;
}

async function reconcileDeliveredReminderState(
  settings: ReviewReminderSettings,
): Promise<ReviewReminderSettings> {
  if (!settings.notificationId || !settings.scheduledDate) {
    return settings;
  }

  const scheduledDate = parseIsoDate(settings.scheduledDate);
  if (!scheduledDate) {
    return clearReminderScheduleFields(settings);
  }

  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
    const exists = scheduledNotifications.some(
      (item) => item.identifier === settings.notificationId,
    );
    if (exists) {
      return settings;
    }
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to inspect scheduled notifications.', { error });
    return settings;
  }

  const scheduledDateKey = toDateOnlyString(scheduledDate);
  const hasTriggered = scheduledDate.getTime() <= Date.now();
  const nextSettings = normalizeSettings({
    ...settings,
    notificationId: null,
    scheduledDate: null,
    lastReminderDate: hasTriggered ? scheduledDateKey : settings.lastReminderDate,
    updatedAt: new Date().toISOString(),
  });
  await writePersistedSettings(nextSettings);
  Logger.info(SERVICE_SCOPE, 'Reconciled consumed reminder schedule from local state.', {
    hadTriggered: hasTriggered,
    scheduledDateKey,
  });
  return nextSettings;
}

export async function getSettings(): Promise<ReviewReminderSettings> {
  return readPersistedSettings();
}

export async function saveSettings(settings: ReviewReminderSettings): Promise<ReviewReminderSettings> {
  const normalized = normalizeSettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  });
  await writePersistedSettings(normalized);
  return normalized;
}

export async function setEnabled(enabled: boolean): Promise<ReviewReminderSettings> {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    enabled,
    updatedAt: new Date().toISOString(),
  });
  await writePersistedSettings(next);
  return next;
}

export async function setTime(hour: number, minute: number): Promise<ReviewReminderSettings> {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    hour,
    minute,
    updatedAt: new Date().toISOString(),
  });
  await writePersistedSettings(next);
  return next;
}

export async function checkPermission(): Promise<boolean> {
  try {
    const status = await Notifications.getPermissionsAsync();
    return isPermissionGranted(status);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to check notification permission.', { error });
    return false;
  }
}

export async function requestPermissionIfNeeded(): Promise<boolean> {
  const currentStatus = await Notifications.getPermissionsAsync();
  if (isPermissionGranted(currentStatus)) {
    return true;
  }

  const nextStatus = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
      allowDisplayInCarPlay: false,
      allowProvisional: false,
      provideAppNotificationSettings: true,
    },
  });
  return isPermissionGranted(nextStatus);
}

export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '复做提醒',
    importance: Notifications.AndroidImportance.DEFAULT,
    enableLights: true,
    enableVibrate: true,
    vibrationPattern: [0, 180, 80, 180],
    lightColor: '#2A9D50',
    sound: 'default',
  });
}

export async function openSystemNotificationSettings(): Promise<void> {
  await Linking.openSettings();
}

export async function refreshReminderSchedule(
  options?: { reason?: string },
): Promise<ReminderScheduleRefreshResult> {
  const reason = options?.reason ?? 'unknown';
  Logger.info(SERVICE_SCOPE, 'Start refresh reminder schedule.', { reason });

  const pendingTodayCount = await MistakeListService.getPendingReviewCountByDate(new Date());
  let settings = await getSettings();
  settings = await reconcileDeliveredReminderState(settings);

  if (!settings.enabled) {
    settings = await clearReminderScheduleFields(settings);
    Logger.info(SERVICE_SCOPE, 'Reminder schedule cleared because reminder disabled.', { reason });
    return {
      settings,
      hasPermission: true,
      pendingTodayCount,
      scheduled: false,
    };
  }

  const hasPermission = await checkPermission();
  if (!hasPermission) {
    settings = await clearReminderScheduleFields(settings);
    Logger.warn(SERVICE_SCOPE, 'Reminder schedule cleared because notification permission denied.', {
      reason,
    });
    return {
      settings,
      hasPermission,
      pendingTodayCount,
      scheduled: false,
    };
  }

  await ensureNotificationChannel();

  const now = new Date();
  const nextReminderDate = await findNextReminderDate(settings, now);
  if (!nextReminderDate) {
    settings = await clearReminderScheduleFields(settings);
    Logger.info(SERVICE_SCOPE, 'No upcoming due reminders found, schedule cleared.', {
      reason,
      pendingTodayCount,
    });
    return {
      settings,
      hasPermission,
      pendingTodayCount,
      scheduled: false,
    };
  }

  const nextIso = nextReminderDate.toISOString();
  if (
    settings.notificationId &&
    settings.scheduledDate &&
    isSameScheduleDateTime(settings.scheduledDate, nextIso)
  ) {
    Logger.info(SERVICE_SCOPE, 'Reminder schedule unchanged.', {
      reason,
      scheduledDate: settings.scheduledDate,
      pendingTodayCount,
    });
    return {
      settings,
      hasPermission,
      pendingTodayCount,
      scheduled: true,
    };
  }

  if (settings.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(settings.notificationId).catch((error) => {
      Logger.warn(SERVICE_SCOPE, 'Cancel previous reminder before reschedule failed.', {
        notificationId: settings.notificationId,
        error,
      });
    });
  }

  const notificationId = await scheduleOneShotReminder(nextReminderDate);
  settings = normalizeSettings({
    ...settings,
    notificationId,
    scheduledDate: nextIso,
    updatedAt: new Date().toISOString(),
  });
  await writePersistedSettings(settings);

  Logger.info(SERVICE_SCOPE, 'Scheduled next reminder successfully.', {
    reason,
    pendingTodayCount,
    scheduledDate: nextIso,
    reminderDateKey: toDateOnlyString(nextReminderDate),
  });

  return {
    settings,
    hasPermission,
    pendingTodayCount,
    scheduled: true,
  };
}

export async function markReminderDelivered(date: Date): Promise<ReviewReminderSettings> {
  const current = await getSettings();
  const dateKey = toDateOnlyString(date);
  const next = normalizeSettings({
    ...current,
    lastReminderDate: dateKey,
    notificationId: null,
    scheduledDate: null,
    updatedAt: new Date().toISOString(),
  });
  await writePersistedSettings(next);
  Logger.info(SERVICE_SCOPE, 'Marked reminder delivered.', { reminderDate: dateKey });
  return next;
}

export function extractReminderDateFromResponse(response: Notifications.NotificationResponse): Date | null {
  const data = response.notification.request.content.data as
    | {
        type?: unknown;
        reminderDateKey?: unknown;
        scheduledDate?: unknown;
      }
    | undefined;

  if (data?.type !== REMINDER_TYPE) {
    return null;
  }

  if (typeof data.scheduledDate === 'string') {
    const scheduled = parseIsoDate(data.scheduledDate);
    if (scheduled) {
      return scheduled;
    }
  }

  if (typeof data.reminderDateKey === 'string') {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.reminderDateKey);
    if (matched) {
      const year = Number(matched[1]);
      const month = Number(matched[2]) - 1;
      const day = Number(matched[3]);
      return new Date(year, month, day, 12, 0, 0, 0);
    }
  }

  return new Date();
}

export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<boolean> {
  const reminderDate = extractReminderDateFromResponse(response);
  if (!reminderDate) {
    return false;
  }

  await markReminderDelivered(reminderDate);
  return true;
}

