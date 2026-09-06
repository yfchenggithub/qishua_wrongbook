import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

const INITIAL_AUTO_HIDE_DELAY_MS = 1_800;
const RESTORED_AUTO_HIDE_DELAY_MS = 3_000;

export type AutoHidingControls = {
  controlsVisible: boolean;
  toggleControls: () => void;
  hideControls: () => void;
  cancelAutoHide: () => void;
};

export function useAutoHidingControls(active: boolean): AutoHidingControls {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelAutoHide = useCallback(() => {
    if (autoHideTimerRef.current === null) {
      return;
    }

    clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = null;
  }, []);

  const scheduleAutoHide = useCallback((delay: number) => {
    cancelAutoHide();
    if (screenReaderEnabled) {
      return;
    }

    autoHideTimerRef.current = setTimeout(() => {
      autoHideTimerRef.current = null;
      setControlsVisible(false);
    }, delay);
  }, [cancelAutoHide, screenReaderEnabled]);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (mounted) {
        setScreenReaderEnabled(enabled);
      }
    }).catch(() => {
      // Keep the default behavior if the platform cannot report accessibility state.
    });

    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderEnabled,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    cancelAutoHide();
    setControlsVisible(true);

    if (active && !screenReaderEnabled) {
      scheduleAutoHide(INITIAL_AUTO_HIDE_DELAY_MS);
    }

    return cancelAutoHide;
  }, [active, cancelAutoHide, scheduleAutoHide, screenReaderEnabled]);

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      cancelAutoHide();
      setControlsVisible(false);
      return;
    }

    setControlsVisible(true);
    scheduleAutoHide(RESTORED_AUTO_HIDE_DELAY_MS);
  }, [cancelAutoHide, controlsVisible, scheduleAutoHide]);

  const hideControls = useCallback(() => {
    cancelAutoHide();
    setControlsVisible(false);
  }, [cancelAutoHide]);

  return {
    controlsVisible,
    toggleControls,
    hideControls,
    cancelAutoHide,
  };
}
