import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, type ScrollView, type ScrollViewProps } from 'react-native';

type NavigationRequest = {
  y: number;
  commit: () => void;
  scrolling: boolean;
  removeKeyboardListener?: () => void;
};

// Keep the outgoing content mounted until scrolling has finished. Replacing a
// long group first lets the native scroll view clamp its offset before animation.
export function useReviewGroupNavigation(
  scrollRef: React.RefObject<ScrollView | null>,
  scope: string,
) {
  const [transitioning, setTransitioning] = useState(false);
  const pending = useRef<NavigationRequest | null>(null);
  const position = useRef({ y: 0, max: Infinity });
  const reduceMotion = useRef(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) reduceMotion.current = value;
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      reduceMotion.current = value;
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    pending.current?.removeKeyboardListener?.();
    pending.current = null;
    setTransitioning(false);
    return () => {
      pending.current?.removeKeyboardListener?.();
      pending.current = null;
    };
  }, [scope]);
  const cancel = useCallback(() => {
    pending.current?.removeKeyboardListener?.();
    pending.current = null;
    setTransitioning(false);
  }, []);
  const complete = useCallback(() => {
    const request = pending.current;
    if (!request) return;
    request.removeKeyboardListener?.();
    pending.current = null;
    request.commit();
    setTransitioning(false);
  }, []);
  function navigate(y: number | undefined, commit: () => void, prepare?: () => Promise<void>) {
    if (pending.current) return;
    const request: NavigationRequest = {
      y: Math.max(0, (y ?? 12) - 12),
      commit,
      scrolling: false,
    };
    pending.current = request;
    setTransitioning(true);
    let keyboardReady = !Keyboard.isVisible();
    let previewReady = !prepare;
    function scroll() {
      if (pending.current !== request || request.scrolling || !keyboardReady || !previewReady)
        return;
      request.y = Math.min(request.y, position.current.max);
      if (y === undefined || !scrollRef.current || Math.abs(position.current.y - request.y) < 1) {
        complete();
        return;
      }
      request.scrolling = true;
      scrollRef.current.scrollTo({ y: request.y, animated: !reduceMotion.current });
    }
    if (!keyboardReady) {
      const subscription = Keyboard.addListener('keyboardDidHide', () => {
        keyboardReady = true;
        subscription.remove();
        scroll();
      });
      request.removeKeyboardListener = () => subscription.remove();
    }
    Keyboard.dismiss();
    if (prepare) {
      const ready = () => {
        previewReady = true;
        scroll();
      };
      void prepare().then(ready, ready);
    } else scroll();
  }
  const onScroll: NonNullable<ScrollViewProps['onScroll']> = useCallback(
    ({ nativeEvent: event }) => {
      position.current = {
        y: event.contentOffset.y,
        max: Math.max(0, event.contentSize.height - event.layoutMeasurement.height),
      };
      const request = pending.current;
      if (request?.scrolling && Math.abs(event.contentOffset.y - request.y) < 1) complete();
    },
    [complete],
  );
  const onMomentumScrollEnd: NonNullable<ScrollViewProps['onMomentumScrollEnd']> = useCallback(
    (event) => {
      onScroll(event);
      if (pending.current?.scrolling) complete();
    },
    [onScroll, complete],
  );
  return { transitioning, navigate, cancel, onScroll, onMomentumScrollEnd };
}
