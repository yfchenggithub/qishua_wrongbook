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
`;

export const CREATE_SCHEMA_SQL = `
${CREATE_MISTAKES_TABLE_SQL}
${CREATE_REVIEW_RECORDS_TABLE_SQL}
${CREATE_MISTAKE_IMAGES_TABLE_SQL}
${CREATE_INDEXES_SQL}
`;
