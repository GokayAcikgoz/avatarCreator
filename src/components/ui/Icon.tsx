import { SVGProps } from "react";

/** AvatarForge's own stroke icon set (24×24, 1.75px strokes) — no icon-font or third-party dependency. */
const PATHS: Record<string, string> = {
  sparkles: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6L5 15z",
  body: "M12 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 8.5h12M9 8.5l-.5 5.5 1.5 8M15 8.5l.5 5.5-1.5 8M12 14v8",
  face: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01",
  eye: "M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  hair: "M4 14c0-6 3.5-10 8-10s8 4 8 10M4 14c1.5-2 3-5 3.5-7M20 14c-1.5-2-3-5-3.5-7M9 5.5c1 2 3 3.5 6 4M4 14v5M20 14v5",
  beard: "M5 8c0 7 3 12 7 12s7-5 7-12M5 8c2 2 4 3 7 3s5-1 7-3M9 14.5c1 .8 2 1 3 1s2-.2 3-1",
  shirt: "M8 3l-5 3 2 4 2.5-1V21h9V9l2.5 1 2-4-5-3c-.6 1.6-2 2.6-4 2.6S8.6 4.6 8 3z",
  pants: "M6 3h12l1 18h-5l-2-11-2 11H5L6 3zM6 7h12",
  shoe: "M3 17V9.5c1.5.5 3 .5 4-1l7 5c2 .5 5 1 7 2.5V17H3zM3 20h18M8 12l1.5-1M10.5 13.5l1.5-1",
  glasses: "M6.5 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17.5 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 13c1.3-1 2.7-1 4 0M3 13H2M21 13h1",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01",
  cloud: "M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5H7zM12 11v5M9.5 13.5L12 11l2.5 2.5",
  download: "M12 3v12M7 10l5 5 5-5M4 19h16",
  upload: "M12 21V9M7 14l5-5 5 5M4 5h16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.2-4 4.3-6 8-6s6.8 2 8 6",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h11",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pencil: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  cube: "M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5L12 2.5zM12 12l8.5-4.75M12 12v9.5M12 12L3.5 7.25",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4",
  focus: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 12h.01",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
  lock: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11z",
  play: "M8 5.5v13l10.5-6.5L8 5.5z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  palette: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3c.4.5.5 1 .5 1.5 0 .7-1.3 1.2-3 1.2zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01",
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3zM8 3v5h7V3M8 21v-7h8v7",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  menu: "M4 7h16M4 12h16M4 17h16",
  camera: "M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.7-2.5h5l1.7 2.5h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, strokeWidth = 1.75, ...props }: { name: IconName | string; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PATHS[name] ?? PATHS.sparkles} />
    </svg>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
