export interface ModuleImportRecord {
  id: string;
  package_id: string;
  content_version: number;
  module_id: number;
  source_module_name: string;
  description: string | null;
  creator_name: string | null;
  package_created_at: string;
  imported_at: string;
}

export interface ModuleImportItemRecord {
  import_id: string;
  item_id: string;
  mistake_id: string;
  position: number;
}

export interface ModuleImportWithItems extends ModuleImportRecord {
  items: ModuleImportItemRecord[];
}

export interface CreateModuleImportItemInput {
  itemId: string;
  mistakeId: string;
  position: number;
}

export interface CreateModuleImportInput {
  id?: string;
  packageId: string;
  contentVersion: number;
  moduleId: number;
  sourceModuleName: string;
  description?: string | null;
  creatorName?: string | null;
  packageCreatedAt: string;
  importedAt?: string;
  items: CreateModuleImportItemInput[];
}

export interface ListModuleImportsOptions {
  limit?: number;
  offset?: number;
}
