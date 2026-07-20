export const MAX_REVIEW_COUNT = 7 as const;

export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60] as const;

export const REVIEW_TEXT_NOTE_MAX_LENGTH = 5000;

export const REVIEW_STATUS = {
  COLLECTED: "collected",
  ACTIVE: "active",
  MASTERED: "mastered",
  ARCHIVED: "archived",
} as const;

export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];
