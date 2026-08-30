import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme(): [Theme, () => void] {
  // Dark is the signature look; light is opt-in.
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('sky-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('sky-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
