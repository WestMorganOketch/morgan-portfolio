"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export type MotionPreference = "auto" | "paused";

type MotionPreferenceContextValue = {
  preference: MotionPreference;
  setPreference: (preference: MotionPreference) => void;
  isSpinning: boolean;
  setIsSpinning: (spinning: boolean) => void;
};

const MotionPreferenceContext = createContext<MotionPreferenceContextValue | null>(null);
const MOTION_STORAGE_KEY = "motion";
const MOTION_CHANGE_EVENT = "morgan-motion-preference";
let memoryPreference: MotionPreference = "auto";

function readPreference(): MotionPreference {
  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    memoryPreference = stored === "paused" ? "paused" : "auto";
    return memoryPreference;
  } catch {
    return memoryPreference;
  }
}

function subscribePreference(onChange: () => void) {
  window.addEventListener(MOTION_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MOTION_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getServerPreference(): MotionPreference {
  return "auto";
}

export function MotionPreferenceProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    getServerPreference,
  );
  const [isSpinning, setIsSpinning] = useState(false);

  const setPreference = useCallback((next: MotionPreference) => {
    memoryPreference = next;
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, next);
    } catch {
      // The control still works for this visit when storage is unavailable.
    }
    window.dispatchEvent(new Event(MOTION_CHANGE_EVENT));
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference, isSpinning, setIsSpinning }),
    [preference, setPreference, isSpinning],
  );

  return (
    <MotionPreferenceContext.Provider value={value}>
      {children}
    </MotionPreferenceContext.Provider>
  );
}

export function useMotionPreference() {
  const value = useContext(MotionPreferenceContext);
  if (!value) {
    throw new Error("useMotionPreference must be used inside MotionPreferenceProvider.");
  }
  return value;
}
