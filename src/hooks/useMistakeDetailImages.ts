import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DetailImageSlot } from '@/src/models/MistakeDetailViewModel';
import { ImageService, Logger, MistakeDetailService } from '@/src/services';
import type { ManagedDetailImageType } from '@/src/services/MistakeDetailService';

const HOOK_SCOPE = 'MistakeDetailImages';

type ToastType = 'success' | 'info' | 'error';

type UseMistakeDetailImagesParams = {
  mistakeId: string | null;
  imageSlots: DetailImageSlot[];
  refreshDetail: () => Promise<void>;
  showToast: (message: string, type?: ToastType) => void;
};

type UseMistakeDetailImagesResult = {
  orderedSlots: DetailImageSlot[];
  takePhotoType: ManagedDetailImageType | null;
  pickImageType: ManagedDetailImageType | null;
  deleteType: ManagedDetailImageType | null;
  isTypeBusy: (type: ManagedDetailImageType) => boolean;
  takePhotoForType: (type: ManagedDetailImageType) => Promise<void>;
  pickImageForType: (type: ManagedDetailImageType) => Promise<void>;
  deleteImageForType: (type: ManagedDetailImageType) => Promise<boolean>;
};

const SLOT_ORDER: ManagedDetailImageType[] = ['question', 'my_solution', 'answer'];

function isManagedType(type: string): type is ManagedDetailImageType {
  return type === 'question' || type === 'my_solution' || type === 'answer';
}

function isCancelLikeMessage(message?: string): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return normalized.includes('cancel') || normalized.includes('取消');
}

function toShortUri(uri: string | null | undefined): string | null {
  if (!uri) {
    return null;
  }
  const normalized = uri.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-20)}`;
}

export function useMistakeDetailImages({
  mistakeId,
  imageSlots,
  refreshDetail,
  showToast,
}: UseMistakeDetailImagesParams): UseMistakeDetailImagesResult {
  const [takePhotoType, setTakePhotoType] = useState<ManagedDetailImageType | null>(null);
  const [pickImageType, setPickImageType] = useState<ManagedDetailImageType | null>(null);
  const [deleteType, setDeleteType] = useState<ManagedDetailImageType | null>(null);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!mistakeId) {
      return;
    }
    Logger.info(HOOK_SCOPE, 'Start loading detail images.', {
      mistakeId,
      slotCount: imageSlots.length,
    });
  }, [imageSlots.length, mistakeId]);

  const orderedSlots = useMemo(() => {
    const slotMap = new Map<ManagedDetailImageType, DetailImageSlot>();
    for (const slot of imageSlots) {
      if (!isManagedType(slot.type)) {
        continue;
      }
      slotMap.set(slot.type, slot);
    }

    return SLOT_ORDER.map((type) => slotMap.get(type)).filter(
      (slot): slot is DetailImageSlot => !!slot,
    );
  }, [imageSlots]);

  useEffect(() => {
    if (!mistakeId) {
      return;
    }
    Logger.info(HOOK_SCOPE, 'Detail images loaded.', {
      mistakeId,
      loadedTypes: orderedSlots.map((slot) => slot.type),
    });
  }, [mistakeId, orderedSlots]);

  const isTypeBusy = useCallback(
    (type: ManagedDetailImageType) =>
      takePhotoType === type || pickImageType === type || deleteType === type,
    [deleteType, pickImageType, takePhotoType],
  );

  const takePhotoForType = useCallback(
    async (type: ManagedDetailImageType) => {
      if (!mistakeId) {
        return;
      }
      if (takePhotoType !== null || pickImageType !== null || deleteType !== null) {
        return;
      }

      Logger.info(HOOK_SCOPE, 'Take photo clicked.', {
        mistakeId,
        imageType: type,
      });
      setTakePhotoType(type);

      try {
        const saveResult = await ImageService.takePhotoAndSave({
          mistakeId,
          type,
        });
        const imageUri = saveResult.image?.uri?.trim();

        if (!saveResult.ok || !imageUri) {
          if (isCancelLikeMessage(saveResult.errorMessage)) {
            Logger.info(HOOK_SCOPE, 'Take photo canceled by user.', {
              mistakeId,
              imageType: type,
            });
            return;
          }

          Logger.warn(HOOK_SCOPE, 'Take photo failed before database update.', {
            mistakeId,
            imageType: type,
            errorMessage: saveResult.errorMessage ?? null,
          });
          showToast('图片保存失败，已保留原图', 'error');
          return;
        }

        Logger.info(HOOK_SCOPE, 'Photo captured and saved to local storage.', {
          mistakeId,
          imageType: type,
          imageUriShort: toShortUri(imageUri),
        });

        const persistResult = await MistakeDetailService.upsertMistakeDetailImage({
          mistakeId,
          imageType: type,
          imageUri,
        });
        if (!persistResult.ok) {
          Logger.error(HOOK_SCOPE, 'Database update failed after photo captured.', {
            mistakeId,
            imageType: type,
            errorMessage: persistResult.errorMessage ?? null,
          });
          showToast('图片保存失败，已保留原图', 'error');
          return;
        }

        Logger.info(HOOK_SCOPE, 'Database updated after taking photo.', {
          mistakeId,
          imageType: type,
          imageId: persistResult.imageId ?? null,
        });

        await refreshDetail();
      } catch (error) {
        Logger.error(HOOK_SCOPE, 'takePhotoForType failed unexpectedly.', {
          mistakeId,
          imageType: type,
          error,
        });
        showToast('图片保存失败，已保留原图', 'error');
      } finally {
        if (isMountedRef.current) {
          setTakePhotoType(null);
        }
      }
    },
    [deleteType, mistakeId, pickImageType, refreshDetail, showToast, takePhotoType],
  );

  const pickImageForType = useCallback(
    async (type: ManagedDetailImageType) => {
      if (!mistakeId) {
        return;
      }
      if (takePhotoType !== null || pickImageType !== null || deleteType !== null) {
        return;
      }

      Logger.info(HOOK_SCOPE, 'Pick image clicked.', {
        mistakeId,
        imageType: type,
      });
      setPickImageType(type);

      try {
        const saveResult = await ImageService.pickImageAndSave({
          mistakeId,
          type,
        });
        const imageUri = saveResult.image?.uri?.trim();

        if (!saveResult.ok || !imageUri) {
          if (isCancelLikeMessage(saveResult.errorMessage)) {
            Logger.info(HOOK_SCOPE, 'Pick image canceled by user.', {
              mistakeId,
              imageType: type,
            });
            return;
          }

          Logger.warn(HOOK_SCOPE, 'Pick image failed before database update.', {
            mistakeId,
            imageType: type,
            errorMessage: saveResult.errorMessage ?? null,
          });
          showToast('图片保存失败，已保留原图', 'error');
          return;
        }

        Logger.info(HOOK_SCOPE, 'Image picked and saved to local storage.', {
          mistakeId,
          imageType: type,
          imageUriShort: toShortUri(imageUri),
        });

        const persistResult = await MistakeDetailService.upsertMistakeDetailImage({
          mistakeId,
          imageType: type,
          imageUri,
        });
        if (!persistResult.ok) {
          Logger.error(HOOK_SCOPE, 'Database update failed after picking image.', {
            mistakeId,
            imageType: type,
            errorMessage: persistResult.errorMessage ?? null,
          });
          showToast('图片保存失败，已保留原图', 'error');
          return;
        }

        Logger.info(HOOK_SCOPE, 'Database updated after picking image.', {
          mistakeId,
          imageType: type,
          imageId: persistResult.imageId ?? null,
        });

        await refreshDetail();
      } catch (error) {
        Logger.error(HOOK_SCOPE, 'pickImageForType failed unexpectedly.', {
          mistakeId,
          imageType: type,
          error,
        });
        showToast('图片保存失败，已保留原图', 'error');
      } finally {
        if (isMountedRef.current) {
          setPickImageType(null);
        }
      }
    },
    [deleteType, mistakeId, pickImageType, refreshDetail, showToast, takePhotoType],
  );

  const deleteImageForType = useCallback(
    async (type: ManagedDetailImageType) => {
      if (!mistakeId) {
        return false;
      }
      if (takePhotoType !== null || pickImageType !== null || deleteType !== null) {
        return false;
      }

      setDeleteType(type);
      try {
        const result = await MistakeDetailService.deleteMistakeDetailImage(mistakeId, type);
        if (!result.ok) {
          Logger.error(HOOK_SCOPE, 'Delete image failed.', {
            mistakeId,
            imageType: type,
            errorMessage: result.errorMessage ?? null,
          });
          showToast('删除失败，请稍后重试', 'error');
          return false;
        }

        Logger.info(HOOK_SCOPE, 'Delete image success.', {
          mistakeId,
          imageType: type,
          deletedCount: result.deletedCount ?? 0,
        });

        showToast('图片已删除', 'info');
        await refreshDetail();
        return true;
      } catch (error) {
        Logger.error(HOOK_SCOPE, 'deleteImageForType failed unexpectedly.', {
          mistakeId,
          imageType: type,
          error,
        });
        showToast('删除失败，请稍后重试', 'error');
        return false;
      } finally {
        if (isMountedRef.current) {
          setDeleteType(null);
        }
      }
    },
    [deleteType, mistakeId, pickImageType, refreshDetail, showToast, takePhotoType],
  );

  return {
    orderedSlots,
    takePhotoType,
    pickImageType,
    deleteType,
    isTypeBusy,
    takePhotoForType,
    pickImageForType,
    deleteImageForType,
  };
}
