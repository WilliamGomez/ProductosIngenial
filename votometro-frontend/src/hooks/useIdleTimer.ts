import { useEffect, useRef } from "react";

const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

interface UseIdleTimerOptions {
  enabled: boolean;
  timeoutMs?: number;
  onIdle: () => void | Promise<void>;
}

export const useIdleTimer = ({
  enabled,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  onIdle,
}: UseIdleTimerOptions) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    const clearIdleTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const resetIdleTimer = () => {
      clearIdleTimer();
      timerRef.current = setTimeout(() => {
        void onIdleRef.current();
      }, timeoutMs);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "pointerdown",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();

    return () => {
      clearIdleTimer();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetIdleTimer);
      });
    };
  }, [enabled, timeoutMs]);
};
