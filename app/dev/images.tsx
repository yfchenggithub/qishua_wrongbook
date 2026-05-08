import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { LocalImageType } from '@/src/models/LocalImage';
import type { PermissionRequestResult } from '@/src/services/ImagePickerService';
import { requestCameraPermission, requestMediaLibraryPermission } from '@/src/services/ImagePickerService';
import { deleteLocalImage, deleteMistakeImages, getLocalImageInfo, pickImageAndSave, takePhotoAndSave } from '@/src/services/ImageService';
import { listMistakeImageFiles } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';

const PAGE_SCOPE = 'DevImagesPage';
const DEV_MISTAKE_ID = 'dev-image-test';

type ActionType =
  | 'check-camera'
  | 'check-library'
  | 'take-photo'
  | 'pick-image'
  | 'refresh-list'
  | 'delete-image'
  | 'delete-folder'
  | null;

type DevImageItem = {
  uri: string;
  exists: boolean;
  fileSize?: number | null;
};

type ImageActionConfig = {
  label: string;
  type: LocalImageType;
};

const PHOTO_ACTIONS: ImageActionConfig[] = [
  { label: '拍题目照片', type: 'question' },
  { label: '拍我的做法', type: 'my_solution' },
  { label: '拍答案/解析', type: 'answer' },
  { label: '拍复做照片', type: 'review_solution' },
];

const PICK_ACTIONS: ImageActionConfig[] = [
  { label: '从相册选择题目照片', type: 'question' },
  { label: '从相册选择我的做法', type: 'my_solution' },
  { label: '从相册选择答案/解析', type: 'answer' },
  { label: '从相册选择复做照片', type: 'review_solution' },
];

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function fileNameFromUri(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

export default function DevImagesPage() {
  const router = useRouter();

  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [statusMessage, setStatusMessage] = useState('等待操作');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = useState<PermissionRequestResult | null>(null);
  const [libraryPermission, setLibraryPermission] = useState<PermissionRequestResult | null>(null);
  const [images, setImages] = useState<DevImageItem[]>([]);

  const isBusy = activeAction !== null;

  const actionLabel = useMemo(() => {
    switch (activeAction) {
      case 'check-camera':
        return '正在检查相机权限...';
      case 'check-library':
        return '正在检查相册权限...';
      case 'take-photo':
        return '正在拍照并保存...';
      case 'pick-image':
        return '正在选图并保存...';
      case 'refresh-list':
        return '正在刷新图片列表...';
      case 'delete-image':
        return '正在删除图片...';
      case 'delete-folder':
        return '正在删除图片目录...';
      default:
        return '';
    }
  }, [activeAction]);

  async function runAction(action: Exclude<ActionType, null>, handler: () => Promise<void>) {
    setActiveAction(action);
    setErrorMessage(null);
    try {
      await handler();
    } catch (error) {
      Logger.error(PAGE_SCOPE, `${action} action failed.`, error);
      const message = formatError(error);
      setErrorMessage(message);
      setStatusMessage(`${action} 失败: ${message}`);
    } finally {
      setActiveAction(null);
    }
  }

  const refreshImageList = useCallback(async () => {
    await runAction('refresh-list', async () => {
      const uris = await listMistakeImageFiles(DEV_MISTAKE_ID);
      const items = await Promise.all(
        uris.map(async (uri) => {
          const info = await getLocalImageInfo(uri);
          return {
            uri,
            exists: info.exists,
            fileSize: info.size ?? null,
          };
        }),
      );
      setImages(items);
      setStatusMessage(`已刷新，共 ${items.length} 张图片`);
    });
  }, []);

  useEffect(() => {
    refreshImageList().catch((error) => {
      Logger.error(PAGE_SCOPE, 'Failed to refresh image list on mount.', error);
      setErrorMessage(formatError(error));
    });
  }, [refreshImageList]);

  async function handleCheckCameraPermission() {
    await runAction('check-camera', async () => {
      const result = await requestCameraPermission();
      setCameraPermission(result);
      setStatusMessage(`相机权限检查完成: granted=${String(result.granted)}`);
    });
  }

  async function handleCheckLibraryPermission() {
    await runAction('check-library', async () => {
      const result = await requestMediaLibraryPermission();
      setLibraryPermission(result);
      setStatusMessage(`相册权限检查完成: granted=${String(result.granted)}`);
    });
  }

  async function handleTakePhoto(type: LocalImageType, label: string) {
    await runAction('take-photo', async () => {
      const result = await takePhotoAndSave({
        mistakeId: DEV_MISTAKE_ID,
        type,
      });

      if (!result.ok) {
        const message = result.errorMessage ?? `${label}失败`;
        setErrorMessage(message);
        setStatusMessage(`${label}未完成`);
        return;
      }

      setStatusMessage(`${label}成功: ${result.image?.fileName ?? '(无文件名)'}`);
      await refreshImageList();
    });
  }

  async function handlePickImage(type: LocalImageType, label: string) {
    await runAction('pick-image', async () => {
      const result = await pickImageAndSave({
        mistakeId: DEV_MISTAKE_ID,
        type,
      });

      if (!result.ok) {
        const message = result.errorMessage ?? `${label}失败`;
        setErrorMessage(message);
        setStatusMessage(`${label}未完成`);
        return;
      }

      setStatusMessage(`${label}成功: ${result.image?.fileName ?? '(无文件名)'}`);
      await refreshImageList();
    });
  }

  function confirmDeleteImage(uri: string) {
    Alert.alert('删除图片', `确认删除图片？\n${fileNameFromUri(uri)}`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void runAction('delete-image', async () => {
            const ok = await deleteLocalImage(uri);
            setStatusMessage(ok ? `已删除: ${fileNameFromUri(uri)}` : `删除失败: ${fileNameFromUri(uri)}`);
            if (!ok) {
              setErrorMessage('删除图片失败，请查看日志');
            }
            await refreshImageList();
          });
        },
      },
    ]);
  }

  function confirmDeleteFolder() {
    Alert.alert(
      '删除目录确认',
      `将删除 ${DEV_MISTAKE_ID} 下全部图片，是否继续？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认删除',
          style: 'destructive',
          onPress: () => {
            void runAction('delete-folder', async () => {
              const ok = await deleteMistakeImages(DEV_MISTAKE_ID);
              setStatusMessage(ok ? '图片目录已删除' : '图片目录删除失败或目录不存在');
              if (!ok) {
                setErrorMessage('删除目录未成功，请查看日志');
              }
              await refreshImageList();
            });
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: '图片持久化调试', headerShown: false }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
          <Text style={styles.pageTitle}>图片持久化调试</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>开发说明</Text>
          <Text style={styles.textLine}>仅开发调试使用</Text>
          <Text style={styles.textLine}>不写入 SQLite</Text>
          <Text style={styles.textLine}>不创建正式错题</Text>
          <Text style={styles.textLine}>固定 mistakeId: {DEV_MISTAKE_ID}</Text>
        </View>

        {isBusy ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#111111" />
            <Text style={styles.loadingText}>{actionLabel}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>权限检查</Text>
          <View style={styles.buttonGroup}>
            <Pressable style={styles.actionButton} onPress={handleCheckCameraPermission} disabled={isBusy}>
              <Text style={styles.actionButtonText}>检查相机权限</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={handleCheckLibraryPermission} disabled={isBusy}>
              <Text style={styles.actionButtonText}>检查相册权限</Text>
            </Pressable>
          </View>
          <View style={styles.innerCard}>
            <Text style={styles.innerTitle}>相机权限</Text>
            <Text style={styles.monoText}>granted: {String(cameraPermission?.granted ?? false)}</Text>
            <Text style={styles.monoText}>status: {cameraPermission?.status ?? '(未检查)'}</Text>
            <Text style={styles.monoText}>canAskAgain: {String(cameraPermission?.canAskAgain ?? false)}</Text>
            <Text style={styles.monoText}>message: {cameraPermission?.message ?? '-'}</Text>
          </View>
          <View style={styles.innerCard}>
            <Text style={styles.innerTitle}>相册权限</Text>
            <Text style={styles.monoText}>granted: {String(libraryPermission?.granted ?? false)}</Text>
            <Text style={styles.monoText}>status: {libraryPermission?.status ?? '(未检查)'}</Text>
            <Text style={styles.monoText}>canAskAgain: {String(libraryPermission?.canAskAgain ?? false)}</Text>
            <Text style={styles.monoText}>message: {libraryPermission?.message ?? '-'}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>拍照保存</Text>
          <View style={styles.buttonGroup}>
            {PHOTO_ACTIONS.map((item) => (
              <Pressable
                key={item.type}
                style={styles.actionButton}
                onPress={() => {
                  void handleTakePhoto(item.type, item.label);
                }}
                disabled={isBusy}>
                <Text style={styles.actionButtonText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>相册选择并保存</Text>
          <View style={styles.buttonGroup}>
            {PICK_ACTIONS.map((item) => (
              <Pressable
                key={item.type}
                style={styles.actionButton}
                onPress={() => {
                  void handlePickImage(item.type, item.label);
                }}
                disabled={isBusy}>
                <Text style={styles.actionButtonText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>图片列表</Text>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                void refreshImageList();
              }}
              disabled={isBusy}>
              <Text style={styles.secondaryButtonText}>刷新图片列表</Text>
            </Pressable>
          </View>
          {images.length === 0 ? (
            <Text style={styles.placeholderText}>暂无图片</Text>
          ) : (
            images.map((item) => (
              <View key={item.uri} style={styles.imageItemCard}>
                <Text style={styles.monoText}>uri: {item.uri}</Text>
                <Image source={{ uri: item.uri }} style={styles.previewImage} resizeMode="contain" />
                <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                <Text style={styles.monoText}>fileSize: {item.fileSize ?? '(未知)'}</Text>
                <Pressable
                  style={[styles.secondaryButton, styles.deleteButton]}
                  onPress={() => confirmDeleteImage(item.uri)}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>删除图片</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>删除目录</Text>
          <Pressable
            style={[styles.actionButton, styles.dangerButton]}
            onPress={confirmDeleteFolder}
            disabled={isBusy}>
            <Text style={styles.actionButtonText}>删除 dev-image-test 图片目录</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>状态</Text>
          <Text style={styles.monoText}>{statusMessage}</Text>
          {errorMessage ? <Text style={styles.errorText}>错误: {errorMessage}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
  },
  loadingText: {
    color: '#333333',
    fontSize: 13,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  textLine: {
    color: '#222222',
    fontSize: 13,
  },
  buttonGroup: {
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dcdcdc',
    alignSelf: 'flex-start',
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#8a1c1c',
  },
  innerCard: {
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  innerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
  },
  imageItemCard: {
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#efefef',
  },
  deleteButton: {
    backgroundColor: '#ffe7e5',
    borderColor: '#f3c9c5',
  },
  monoText: {
    color: '#222222',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  placeholderText: {
    color: '#666666',
    fontSize: 13,
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
    fontWeight: '600',
  },
});
