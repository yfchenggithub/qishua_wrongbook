import { ERROR_REASON_OPTIONS } from '@/src/constants/mistakeOptions';
import type { CustomErrorReason } from '@/src/models/CustomErrorReason';
import { CustomErrorReasonRepository } from '@/src/repositories/CustomErrorReasonRepository';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'CustomErrorReasonService';
export const MAX_CUSTOM_ERROR_REASON_COUNT = 2000;
export const MAX_CUSTOM_ERROR_REASON_NAME_LENGTH = 16;

export const CUSTOM_ERROR_REASON_TEMPLATES = [
  '审题遗漏',
  '条件漏用',
  '单位错误',
  '符号错误',
  '步骤跳跃',
  '时间不够',
  '模型选错',
  '答案抄错',
] as const;

export type MoveCustomErrorReasonDirection = 'up' | 'down';

export type CustomErrorReasonActionResult = {
  ok: boolean;
  reasons?: CustomErrorReason[];
  reason?: CustomErrorReason;
  errorMessage?: string;
};

function normalizeReasonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function validateReasonName(name: string): string | null {
  const normalized = normalizeReasonName(name);
  if (!normalized) {
    return '请输入错因名称。';
  }
  if (normalized.length > MAX_CUSTOM_ERROR_REASON_NAME_LENGTH) {
    return `错因名称最多 ${MAX_CUSTOM_ERROR_REASON_NAME_LENGTH} 个字。`;
  }
  return null;
}

function isSameReasonName(left: string, right: string): boolean {
  return normalizeReasonName(left).toLocaleLowerCase() === normalizeReasonName(right).toLocaleLowerCase();
}

function isDefaultReasonName(name: string): boolean {
  return ERROR_REASON_OPTIONS.some((item) => isSameReasonName(item.value, name) || isSameReasonName(item.label, name));
}

function hasDuplicateCustomReasonName(
  reasons: CustomErrorReason[],
  name: string,
  ignoredId?: string,
): boolean {
  return reasons.some((reasonItem) => reasonItem.id !== ignoredId && isSameReasonName(reasonItem.name, name));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function listReasonsAfterAction(): Promise<CustomErrorReason[]> {
  return CustomErrorReasonRepository.listCustomErrorReasons();
}

export const CustomErrorReasonService = {
  async listCustomErrorReasons(): Promise<CustomErrorReason[]> {
    try {
      return await CustomErrorReasonRepository.listCustomErrorReasons();
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'listCustomErrorReasons failed.', error);
      throw error;
    }
  },

  async createCustomErrorReason(name: string): Promise<CustomErrorReasonActionResult> {
    try {
      const normalizedName = normalizeReasonName(name);
      const validationError = validateReasonName(normalizedName);
      if (validationError) {
        return { ok: false, errorMessage: validationError };
      }

      const reasons = await CustomErrorReasonRepository.listCustomErrorReasons();
      if (reasons.length >= MAX_CUSTOM_ERROR_REASON_COUNT) {
        return {
          ok: false,
          errorMessage: `最多可创建 ${MAX_CUSTOM_ERROR_REASON_COUNT} 个自定义错因。`,
        };
      }

      if (isDefaultReasonName(normalizedName) || hasDuplicateCustomReasonName(reasons, normalizedName)) {
        return {
          ok: false,
          errorMessage: '该错因已存在。',
        };
      }

      const reasonItem = await CustomErrorReasonRepository.createCustomErrorReason({
        name: normalizedName,
      });
      const nextReasons = await listReasonsAfterAction();
      return {
        ok: true,
        reason: reasonItem,
        reasons: nextReasons,
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'createCustomErrorReason failed.', { name, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '创建自定义错因失败。',
      };
    }
  },

  async updateCustomErrorReasonName(
    id: string,
    name: string,
  ): Promise<CustomErrorReasonActionResult> {
    try {
      const normalizedName = normalizeReasonName(name);
      const validationError = validateReasonName(normalizedName);
      if (validationError) {
        return { ok: false, errorMessage: validationError };
      }

      const reasons = await CustomErrorReasonRepository.listCustomErrorReasons();
      if (isDefaultReasonName(normalizedName) || hasDuplicateCustomReasonName(reasons, normalizedName, id)) {
        return {
          ok: false,
          errorMessage: '该错因已存在。',
        };
      }

      const reasonItem = await CustomErrorReasonRepository.updateCustomErrorReason(id, {
        name: normalizedName,
      });
      if (!reasonItem) {
        return {
          ok: false,
          errorMessage: '未找到要编辑的错因。',
        };
      }

      const nextReasons = await listReasonsAfterAction();
      return {
        ok: true,
        reason: reasonItem,
        reasons: nextReasons,
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'updateCustomErrorReasonName failed.', { id, name, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '编辑自定义错因失败。',
      };
    }
  },

  async deleteCustomErrorReason(id: string): Promise<CustomErrorReasonActionResult> {
    try {
      const deleted = await CustomErrorReasonRepository.deleteCustomErrorReason(id);
      if (!deleted) {
        return {
          ok: false,
          errorMessage: '未找到要删除的错因。',
        };
      }

      const nextReasons = await listReasonsAfterAction();
      await CustomErrorReasonRepository.replaceCustomErrorReasonOrder(nextReasons.map((item) => item.id));
      return {
        ok: true,
        reasons: await listReasonsAfterAction(),
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'deleteCustomErrorReason failed.', { id, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '删除自定义错因失败。',
      };
    }
  },

  async moveCustomErrorReason(
    id: string,
    direction: MoveCustomErrorReasonDirection,
  ): Promise<CustomErrorReasonActionResult> {
    try {
      const reasons = await CustomErrorReasonRepository.listCustomErrorReasons();
      const currentIndex = reasons.findIndex((item) => item.id === id);
      if (currentIndex < 0) {
        return {
          ok: false,
          errorMessage: '未找到要排序的错因。',
        };
      }

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= reasons.length) {
        return {
          ok: true,
          reasons,
        };
      }

      const nextReasons = [...reasons];
      const currentReason = nextReasons[currentIndex];
      nextReasons[currentIndex] = nextReasons[targetIndex];
      nextReasons[targetIndex] = currentReason;
      await CustomErrorReasonRepository.replaceCustomErrorReasonOrder(nextReasons.map((item) => item.id));

      return {
        ok: true,
        reasons: await listReasonsAfterAction(),
      };
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'moveCustomErrorReason failed.', { id, direction, error });
      return {
        ok: false,
        errorMessage: toErrorMessage(error) || '调整错因排序失败。',
      };
    }
  },
} as const;
