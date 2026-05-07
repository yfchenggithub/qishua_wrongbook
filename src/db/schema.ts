import { MAX_REVIEW_COUNT } from '@/src/constants/review';

export const CREATE_MISTAKES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT 'math',
  module TEXT NOT NULL,
  title TEXT,
  error_reason TEXT,
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  question_image_uri TEXT,
  answer_image_uri TEXT,
  note TEXT,
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count BETWEEN 0 AND ${MAX_REVIEW_COUNT}),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mastered', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_review_at TEXT
);
`;

export const CREATE_MISTAKE_IMAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistake_images (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('question', 'my_solution', 'answer', 'review_solution')),
  uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_REVIEW_RECORDS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL,
  review_index INTEGER NOT NULL CHECK (review_index BETWEEN 1 AND ${MAX_REVIEW_COUNT}),
  solution_image_uri TEXT,
  result TEXT NOT NULL DEFAULT 'done' CHECK (result IN ('done', 'still_wrong', 'too_easy')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_mistakes_status ON mistakes(status);
CREATE INDEX IF NOT EXISTS idx_mistakes_next_review_at ON mistakes(next_review_at);
CREATE INDEX IF NOT EXISTS idx_mistakes_module ON mistakes(module);
CREATE INDEX IF NOT EXISTS idx_review_records_mistake_id ON review_records(mistake_id);
CREATE INDEX IF NOT EXISTS idx_mistake_images_mistake_id ON mistake_images(mistake_id);
`;

export const CREATE_SCHEMA_SQL = `
${CREATE_MISTAKES_TABLE_SQL}
${CREATE_MISTAKE_IMAGES_TABLE_SQL}
${CREATE_REVIEW_RECORDS_TABLE_SQL}
${CREATE_INDEXES_SQL}
`;
