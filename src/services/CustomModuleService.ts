import { MODULE_OPTIONS } from '@/src/constants/mistakeOptions';
import type { CustomModule } from '@/src/models/CustomModule';
import { CustomModuleRepository } from '@/src/repositories/CustomModuleRepository';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'CustomModuleService';
export const MAX_CUSTOM_MODULE_COUNT = 2000;
export const MAX_CUSTOM_MODULE_NAME_LENGTH = 16;

export const CUSTOM_MODULE_TEMPLATES = [
  '集合与逻辑',
  '函数综合',
  '导数压轴',
  '数列综合',
  '解析几何',
  '概率统计专项',
  '三角恒等变换',
  '复数',
] as const;

export type MoveCustomModuleDirection = 'up' | 'down';

export type CustomModuleActionResult = {
  ok: boolean;
  modules?: CustomModule[];
  module?: CustomModule;
  errorMessage?: string;
};

function normalizeModuleName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function validateModuleName(name: string): string | null {
  const normalized = normalizeModuleName(name);
  if (!normalized) {
    return '请输入模块名称。';
  }
  if (normalized.length > MAX_CUSTOM_MODULE_NAME_LENGTH) {
    return `模块名称最多 ${MAX_CUSTOM_MODULE_NAME_LENGTH} 个字。`;
  }
  return null;
}

function isSameModuleName(left: string, right: string): boolean {
  return normalizeModuleName(left).toLocaleLowerCase() === normalizeModuleName(right).toLocaleLowerCase();
}

function isDefaultModuleName(name: string): boolean {
  return MODULE_OPTIONS.some((item) => isSameModuleName(item.value, name) || isSameModuleName(item.label, name));
}

function hasDuplicateCustomModuleName(
  modules: CustomModule[],
  name: string,
  ignoredId?: string,
): boolean {
  return modules.some((moduleItem) => moduleItem.id !== ignoredId && isSameModuleName(moduleItem.name, name));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function listModulesAfterAction(): Promise<CustomModule[]> {
  return CustomModuleRepository.listCustomModules();
}

export const CustomModuleService = {
  async listCustomModules(): Promise<CustomModule[]> {
    try {
      return await CustomModuleRepository.listCustomModules();
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'listCustomModules failed.', error);
      throw error;
    }
  },

  async createCustomModule(name: string): Promise<CustomModuleActionResult> {
    try {
      const normalizedName = normalizeModuleName(name);
      const validationError = validateModuleName(normalizedName);
      if (validationError) {
        return { ok: false, errorMessage: validationError };
      }

      const modules = await CustomModuleRepository.listCustomModules();
      if (modules.length >= MAX_CUSTOM_MODULE_COUNT) {
        return {
          ok: false,
          errorMessage: `最多可创建 ${MAX_CUSTOM_MODULE_COUNT} 个自定义模块。`,
        };
      }

      if (isDefaultModuleName(normalizedName) || hasDuplicateCustomModuleName(modules, normalizedName)) {
        return {
          ok: false,
          errorMessage: '该模块已存在。',
        };
      }

      const moduleItem = await CustomModuleRepository.createCustomModule({
        name: normalizedName,
      });
      const nextModules = await listModulesAfterAction();
      return {
        ok: true,
        module: moduleItem,
        modules: nextModules,
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'createCustomModule failed.', { name, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '创建自定义模块失败。',
      };
    }
  },

  async updateCustomModuleName(
    id: string,
    name: string,
  ): Promise<CustomModuleActionResult> {
    try {
      const normalizedName = normalizeModuleName(name);
      const validationError = validateModuleName(normalizedName);
      if (validationError) {
        return { ok: false, errorMessage: validationError };
      }

      const modules = await CustomModuleRepository.listCustomModules();
      if (isDefaultModuleName(normalizedName) || hasDuplicateCustomModuleName(modules, normalizedName, id)) {
        return {
          ok: false,
          errorMessage: '该模块已存在。',
        };
      }

      const moduleItem = await CustomModuleRepository.updateCustomModule(id, {
        name: normalizedName,
      });
      if (!moduleItem) {
        return {
          ok: false,
          errorMessage: '未找到要编辑的模块。',
        };
      }

      const nextModules = await listModulesAfterAction();
      return {
        ok: true,
        module: moduleItem,
        modules: nextModules,
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'updateCustomModuleName failed.', { id, name, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '编辑自定义模块失败。',
      };
    }
  },

  async deleteCustomModule(id: string): Promise<CustomModuleActionResult> {
    try {
      const deleted = await CustomModuleRepository.deleteCustomModule(id);
      if (!deleted) {
        return {
          ok: false,
          errorMessage: '未找到要删除的模块。',
        };
      }

      const nextModules = await listModulesAfterAction();
      await CustomModuleRepository.replaceCustomModuleOrder(nextModules.map((item) => item.id));
      return {
        ok: true,
        modules: await listModulesAfterAction(),
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'deleteCustomModule failed.', { id, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '删除自定义模块失败。',
      };
    }
  },

  async moveCustomModule(
    id: string,
    direction: MoveCustomModuleDirection,
  ): Promise<CustomModuleActionResult> {
    try {
      const modules = await CustomModuleRepository.listCustomModules();
      const currentIndex = modules.findIndex((item) => item.id === id);
      if (currentIndex < 0) {
        return {
          ok: false,
          errorMessage: '未找到要排序的模块。',
        };
      }

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= modules.length) {
        return {
          ok: true,
          modules,
        };
      }

      const nextModules = [...modules];
      const currentModule = nextModules[currentIndex];
      nextModules[currentIndex] = nextModules[targetIndex];
      nextModules[targetIndex] = currentModule;
      await CustomModuleRepository.replaceCustomModuleOrder(nextModules.map((item) => item.id));

      return {
        ok: true,
        modules: await listModulesAfterAction(),
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'moveCustomModule failed.', { id, direction, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '调整模块排序失败。',
      };
    }
  },
} as const;
