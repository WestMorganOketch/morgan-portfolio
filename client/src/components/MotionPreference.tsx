"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type MotionPreference = "auto" | "paused";

type MotionPreferenceContextValue = {
  preference: MotionPreference;
  setPreference: (preference: MotionPreference) => void;
  isSpinning: boolean;
  setIsSpinning: (spinning: boolean) => void;
};

const MotionPreferenceContext = createContext<MotionPreferenceContextValue | null>(null);

export function MotionPreferenceProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<MotionPreference>("auto");
  const [isSpinning, setIsSpinning] = useState(false);

  // Read the visitor's choice only after hydration; never access storage during SSR.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("motion") === "paused") {
        setPreferenceState("paused");
      }
    } catch {
      // Storage may be unavailable in private browsing or restricted contexts.
    }
  }, []);

  const setPreference = useCallback((next: MotionPreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem("motion", next);
    } catch {
      // The control remains functional for this visit when storage is unavailable.
    }
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
