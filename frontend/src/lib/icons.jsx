/* Minimal stroke icon set — 1.6px, currentColor, 24-grid. */
const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icon = {
  lark: (p) => (
    <svg {...S} {...p}>
      <path d="M3 15c4 0 6-2 9-7 1.4 3 3 4.5 5 5-2 .8-3.2 2.2-4 4.5" />
      <path d="M12 8c2.5 3.2 5.2 4.7 9 5" />
    </svg>
  ),
  send: (p) => (<svg {...S} {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>),
  plus: (p) => (<svg {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>),
  refresh: (p) => (<svg {...S} {...p}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>),
  sun: (p) => (<svg {...S} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>),
  moon: (p) => (<svg {...S} {...p}><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z" /></svg>),
  report: (p) => (<svg {...S} {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6M10 9h2" /></svg>),
  spark: (p) => (<svg {...S} {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /><path d="M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" /></svg>),
  coin: (p) => (<svg {...S} {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>),
  layers: (p) => (<svg {...S} {...p}><path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 18l9 5 9-5" /></svg>),
  wallet: (p) => (<svg {...S} {...p}><path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h14V9M3 7h16" /><circle cx="17" cy="13" r="1.4" /></svg>),
  box: (p) => (<svg {...S} {...p}><path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3ZM3 7.5 12 12l9-4.5M12 12v9" /></svg>),
  user: (p) => (<svg {...S} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></svg>),
  dot: (p) => (<svg {...S} {...p}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></svg>),
  check: (p) => (<svg {...S} {...p}><path d="M4 12.5 9 17.5 20 6.5" /></svg>),
  chevron: (p) => (<svg {...S} {...p}><path d="M9 6l6 6-6 6" /></svg>),
  close: (p) => (<svg {...S} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>),
  copy: (p) => (<svg {...S} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>),
};
