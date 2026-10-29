export const motionDurations = {
  press: 0.08,
  fast: 0.12,
  base: 0.2,
  modal: 0.18,
  slow: 0.32,
  pageEnter: 0.24,
  reveal: 0.4,
  drawer: 0.28,
  exit: 0.15,
  reduced: 0.1,
  stagger: 0.05,
} as const;

export const motionEasing = {
  enter: [0.22, 1, 0.36, 1] as const,
  move: [0.4, 0, 0.2, 1] as const,
} as const;
