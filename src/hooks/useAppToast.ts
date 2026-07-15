import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';

import type { AppToastProps, AppToastType } from '@/src/components/ui/AppToast';

const DEFAULT_TOAST_DURATION_MS = 1800;
const DEFAULT_ENTER_DURATION_MS = 180;
const DEFAULT_EXIT_DURATION_MS = 160;
const DEFAULT_TRANSLATE_Y = 8;

export interface UseAppToastOptions {
  defaultDuration?: number;
  enterDuration?: number;
  exitDuration?: number;
  translateYOffset?: number;
  animated?: boolean;
}

export interface UseAppToastResult {
  visible: boolean;
  message: string;
  type: AppToastType;
  opacity?: Animated.Value | number;
  translateY?: Animated.Value | number;
  props: Pick<AppToastProps, 'visible' | 'message' | 'type' | 'opacity' | 'translateY'>;
  showToast: (message: string, type?: AppToastType, duration?: number) => void;
  hideToast: () => void;
}

export function useAppToast(options: UseAppToastOptions = {}): UseAppToastResult {
  const {
    defaultDuration = DEFAULT_TOAST_DURATION_MS,
    enterDuration = DEFAULT_ENTER_DURATION_MS,
    exitDuration = DEFAULT_EXIT_DURATION_MS,
    translateYOffset = DEFAULT_TRANSLATE_Y,
    animated = true,
  } = options;

  const [message, setMessage] = useState('');
  const [type, setType] = useState<AppToastType>('info');
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(translateYOffset)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideToast = useCallback(() => {
    clearTimer();
    if (!animated) {
      setVisible(false);
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: exitDuration,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: translateYOffset,
        duration: exitDuration,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
    });
  }, [animated, clearTimer, exitDuration, opacity, translateY, translateYOffset]);

  const showToast = useCallback(
    (nextMessage: string, nextType: AppToastType = 'info', duration = defaultDuration) => {
      const normalizedMessage = nextMessage.trim();
      if (!normalizedMessage) {
        return;
      }

      clearTimer();
      setMessage(normalizedMessage);
      setType(nextType);
      setVisible(true);

      if (animated) {
        opacity.setValue(0);
        translateY.setValue(translateYOffset);
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: enterDuration,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 0,
            duration: enterDuration,
            useNativeDriver: true,
          }),
        ]).start();
      }

      timerRef.current = setTimeout(() => {
        hideToast();
      }, duration);
    },
    [
      animated,
      clearTimer,
      defaultDuration,
      enterDuration,
      hideToast,
      opacity,
      translateY,
      translateYOffset,
    ],
  );

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer],
  );

  const toastProps = useMemo(
    () => ({
      visible,
      message,
      type,
      opacity: animated ? opacity : undefined,
      translateY: animated ? translateY : undefined,
    }),
    [animated, message, opacity, translateY, type, visible],
  );

  return {
    visible,
    message,
    type,
    opacity: animated ? opacity : undefined,
    translateY: animated ? translateY : undefined,
    props: toastProps,
    showToast,
    hideToast,
  };
}
