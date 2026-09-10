export type AppIconName =
  | 'arrow-up'
  | 'chart'
  | 'close'
  | 'error'
  | 'eye'
  | 'help'
  | 'person'
  | 'plug'
  | 'refresh'
  | 'send'
  | 'store'
  | 'target'
  | 'trend'
  | 'upload';

interface Props {
  readonly name: AppIconName;
  readonly className?: string;
}

export function AppIcon({ name, className = '' }: Props): JSX.Element {
  const common = { vectorEffect: 'non-scaling-stroke' as const };
  const paths: Record<AppIconName, JSX.Element> = {
    'arrow-up': <><path d="M12 19V5" {...common} /><path d="m6.5 10.5 5.5-5.5 5.5 5.5" {...common} /></>,
    chart: <><path d="M4 20h16" {...common} /><path d="M7 17v-5M12 17V6M17 17V9" {...common} /></>,
    close: <><path d="M7 7l10 10M17 7 7 17" {...common} /></>,
    error: <><circle cx="12" cy="12" r="8.5" {...common} /><path d="M12 7.5v5M12 16h.01" {...common} /></>,
    eye: <><path d="M3.5 12s3.2-5 8.5-5 8.5 5 8.5 5-3.2 5-8.5 5-8.5-5-8.5-5Z" {...common} /><circle cx="12" cy="12" r="2.2" {...common} /></>,
    help: <><circle cx="12" cy="12" r="8.5" {...common} /><path d="M9.8 9a2.3 2.3 0 1 1 3.2 2.1c-.7.35-1 .8-1 1.6M12 16h.01" {...common} /></>,
    person: <><circle cx="12" cy="8" r="3" {...common} /><path d="M5.5 19c.8-3.2 3-5 6.5-5s5.7 1.8 6.5 5" {...common} /></>,
    plug: <><path d="m8 3 1 5M16 3l-1 5M7 8h10v2a5 5 0 0 1-10 0V8ZM12 15v6" {...common} /></>,
    refresh: <><path d="M19 8V4l-2 2a8 8 0 1 0 2.2 8" {...common} /></>,
    send: <><path d="m3 4 18 8-18 8 3-8-3-8Z" {...common} /><path d="M6 12h15" {...common} /></>,
    store: <><path d="M4 10v10h16V10M3 10l2-6h14l2 6" {...common} /><path d="M8 20v-6h5v6M3 10c0 1.4 1 2.5 2.5 2.5S8 11.4 8 10c0 1.4 1 2.5 2.5 2.5S13 11.4 13 10c0 1.4 1 2.5 2.5 2.5S18 11.4 18 10c0 1.4 1 2.5 2.5 2.5S23 11.4 23 10" {...common} /></>,
    target: <><circle cx="12" cy="12" r="8.5" {...common} /><circle cx="12" cy="12" r="3" {...common} /><path d="m14 10 6-6M16 4h4v4" {...common} /></>,
    trend: <><path d="M4 17 9 12l3 3 7-8" {...common} /><path d="M14 7h5v5" {...common} /></>,
    upload: <><path d="M12 15V4" {...common} /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" {...common} /><path d="M5 16.5v1A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-1" {...common} /></>,
  };

  return (
    <svg className={`app-icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
