import { MAX_REVIEW_COUNT } from '@/src/constants/review';

export const CREATE_MISTAKES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT 'math',
  module TEXT NOT NULL,
  title TEXT,
  error_reason TEXT,
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  note TEXT,
  note_highlights TEXT,
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count BETWEEN 0 AND ${MAX_REVIEW_COUNT}),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mastered', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_review_at TEXT,
  last_review_at TEXT,
  last_review_result TEXT CHECK (
    last_review_result IS NULL
    OR last_review_result IN ('mastered', 'unsure', 'wrong')
  )
);
`;

export const CREATE_REVIEW_RECORDS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL,
  review_index INTEGER NOT NULL CHECK (review_index BETWEEN 1 AND ${MAX_REVIEW_COUNT}),
  result TEXT NOT NULL CHECK (result IN ('mastered', 'unsure', 'wrong')),
  note TEXT,
  note_highlights TEXT,
  voice_note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_MISTAKE_IMAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistake_images (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL,
  review_record_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('question', 'my_solution', 'answer', 'review_solution')),
  uri TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE,
  FOREIGN KEY(review_record_id) REFERENCES review_records(id) ON DELETE CASCADE
);
`;

export const CREATE_REVIEW_SHEETS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS review_sheets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  is_submitted INTEGER NOT NULL DEFAULT 0 CHECK (is_submitted IN (0, 1))
);
`;

export const CREATE_REVIEW_SHEET_ITEMS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS review_sheet_items (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  mistake_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(sheet_id) REFERENCES review_sheets(id) ON DELETE CASCADE,
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_MODULE_QUESTION_COUNTERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS module_question_counters (
  module TEXT PRIMARY KEY,
  last_question_no INTEGER NOT NULL CHECK (last_question_no >= 0),
  updated_at TEXT NOT NULL
);
`;

export const CREATE_CUSTOM_MODULES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS custom_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT 'label',
  color TEXT NOT NULL DEFAULT '#2EBB61',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const CREATE_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_mistakes_status ON mistakes(status);
CREATE INDEX IF NOT EXISTS idx_mistakes_next_review_at ON mistakes(next_review_at);
CREATE INDEX IF NOT EXISTS idx_mistakes_module ON mistakes(module);
CREATE INDEX IF NOT EXISTS idx_mistakes_status_next_review_at ON mistakes(status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_review_records_mistake_id ON review_records(mistake_id);
CREATE INDEX IF NOT EXISTS idx_review_records_created_at ON review_records(created_at);
CREATE INDEX IF NOT EXISTS idx_review_records_result ON review_records(result);
CREATE INDEX IF NOT EXISTS idx_review_records_mistake_review_index ON review_records(mistake_id, review_index);
CREATE INDEX IF NOT EXISTS idx_mistake_images_mistake_id ON mistake_images(mistake_id);
CREATE INDEX IF NOT EXISTS idx_mistake_images_mistake_type ON mistake_images(mistake_id, type);
CREATE INDEX IF NOT EXISTS idx_mistake_images_review_record_id ON mistake_images(review_record_id);
CREATE INDEX IF NOT EXISTS idx_mistake_images_cover ON mistake_images(mistake_id, type, sort_order);
CREATE INDEX IF NOT EXISTS idx_review_sheets_is_submitted ON review_sheets(is_submitted, created_at);
CREATE INDEX IF NOT EXISTS idx_review_sheet_items_sheet_order ON review_sheet_items(sheet_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_review_sheet_items_mistake_id ON review_sheet_items(mistake_id);
CREATE INDEX IF NOT EXISTS idx_custom_modules_sort_order ON custom_modules(sort_order, created_at);
`;

export const CREATE_SCHEMA_SQL = `
${CREATE_MISTAKES_TABLE_SQL}
${CREATE_REVIEW_RECORDS_TABLE_SQL}
${CREATE_MISTAKE_IMAGES_TABLE_SQL}
${CREATE_REVIEW_SHEETS_TABLE_SQL}
${CREATE_REVIEW_SHEET_ITEMS_TABLE_SQL}
${CREATE_MODULE_QUESTION_COUNTERS_TABLE_SQL}
${CREATE_CUSTOM_MODULES_TABLE_SQL}
${CREATE_INDEXES_SQL}
`;
