import { MAX_REVIEW_COUNT } from '@/src/constants/review';
import { BRAND_ACCENT } from '@/src/styles/tokens';

export const CREATE_MODULES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('system', 'custom', 'unclassified')),
  name TEXT NOT NULL UNIQUE,
  display_code TEXT NOT NULL UNIQUE,
  custom_no INTEGER UNIQUE CHECK (
    (type = 'custom' AND custom_no BETWEEN 1 AND 999)
    OR (type <> 'custom' AND custom_no IS NULL)
  ),
  icon TEXT NOT NULL DEFAULT 'label',
  color TEXT NOT NULL DEFAULT '${BRAND_ACCENT}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const CREATE_MISTAKES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT 'math',
  module TEXT NOT NULL,
  module_id INTEGER NOT NULL,
  question_no INTEGER NOT NULL CHECK (question_no BETWEEN 1 AND 999),
  title TEXT,
  error_reason TEXT,
  error_reason_ids TEXT,
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  note TEXT,
  my_solution_text TEXT,
  answer_text TEXT,
  note_highlights TEXT,
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count BETWEEN 0 AND ${MAX_REVIEW_COUNT}),
  status TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'active', 'mastered', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_review_at TEXT,
  last_review_at TEXT,
  last_review_result TEXT CHECK (
    last_review_result IS NULL
    OR last_review_result IN ('mastered', 'unsure', 'wrong')
  ),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  last_viewed_at TEXT,
  UNIQUE(module_id, question_no),
  FOREIGN KEY(module_id) REFERENCES modules(id)
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
  module_id INTEGER PRIMARY KEY,
  last_question_no INTEGER NOT NULL CHECK (last_question_no BETWEEN 0 AND 999),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(module_id) REFERENCES modules(id)
);
`;

export const CREATE_CUSTOM_ERROR_REASONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS custom_error_reasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT 'error-outline',
  color TEXT NOT NULL DEFAULT '#F59E0B',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const CREATE_MISTAKE_RELATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistake_relations (
  id TEXT PRIMARY KEY,
  source_mistake_id TEXT NOT NULL,
  target_mistake_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('system', 'manual')),
  created_at TEXT NOT NULL,
  CHECK (source_mistake_id <> target_mistake_id),
  UNIQUE(source_mistake_id, target_mistake_id),
  FOREIGN KEY(source_mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE,
  FOREIGN KEY(target_mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_MISTAKE_TAGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mistake_tags (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(mistake_id, normalized_name),
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_MODULE_IMPORTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS module_imports (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL UNIQUE,
  content_version INTEGER NOT NULL CHECK (content_version >= 1),
  module_id INTEGER NOT NULL UNIQUE,
  source_module_name TEXT NOT NULL,
  description TEXT,
  creator_name TEXT,
  package_created_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE
);
`;

export const CREATE_MODULE_IMPORT_ITEMS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS module_import_items (
  import_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  mistake_id TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 999),
  PRIMARY KEY(import_id, item_id),
  UNIQUE(import_id, position),
  FOREIGN KEY(import_id) REFERENCES module_imports(id) ON DELETE CASCADE,
  FOREIGN KEY(mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
`;

export const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_modules_type_active_order ON modules(type, is_active, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_mistakes_status ON mistakes(status);
CREATE INDEX IF NOT EXISTS idx_mistakes_next_review_at ON mistakes(next_review_at);
CREATE INDEX IF NOT EXISTS idx_mistakes_module ON mistakes(module);
CREATE INDEX IF NOT EXISTS idx_mistakes_module_id ON mistakes(module_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_module_question_no ON mistakes(module_id, question_no);
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
CREATE INDEX IF NOT EXISTS idx_custom_error_reasons_sort_order ON custom_error_reasons(sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_mistake_relations_source_mistake ON mistake_relations(source_mistake_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mistake_relations_target_mistake ON mistake_relations(target_mistake_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mistake_relations_source ON mistake_relations(source);
CREATE INDEX IF NOT EXISTS idx_mistake_tags_mistake_order ON mistake_tags(mistake_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_mistake_tags_normalized_name ON mistake_tags(normalized_name);
CREATE INDEX IF NOT EXISTS idx_mistake_tags_normalized_mistake ON mistake_tags(normalized_name, mistake_id);
CREATE INDEX IF NOT EXISTS idx_module_imports_imported_at ON module_imports(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_module_import_items_import_position ON module_import_items(import_id, position);
`;

export const CREATE_SCHEMA_SQL = `
${CREATE_MODULES_TABLE_SQL}
${CREATE_MISTAKES_TABLE_SQL}
${CREATE_REVIEW_RECORDS_TABLE_SQL}
${CREATE_MISTAKE_IMAGES_TABLE_SQL}
${CREATE_REVIEW_SHEETS_TABLE_SQL}
${CREATE_REVIEW_SHEET_ITEMS_TABLE_SQL}
${CREATE_MODULE_QUESTION_COUNTERS_TABLE_SQL}
${CREATE_CUSTOM_ERROR_REASONS_TABLE_SQL}
${CREATE_MISTAKE_RELATIONS_TABLE_SQL}
${CREATE_MISTAKE_TAGS_TABLE_SQL}
${CREATE_MODULE_IMPORTS_TABLE_SQL}
${CREATE_MODULE_IMPORT_ITEMS_TABLE_SQL}
${CREATE_INDEXES_SQL}
`;
