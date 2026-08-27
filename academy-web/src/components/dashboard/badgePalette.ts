export interface BadgeTone {
  badgeBg: string;
  badgeColor: string;
  dotColor: string;
}

export const badgePalette: Record<'green' | 'gold' | 'gray', BadgeTone> = {
  green: { badgeBg: 'var(--color-primary)', badgeColor: 'var(--color-tint)', dotColor: 'var(--color-tint)' },
  gold: { badgeBg: 'var(--color-accent)', badgeColor: 'var(--color-primary)', dotColor: 'var(--color-primary)' },
  gray: {
    badgeBg: 'rgba(31,61,43,0.08)',
    badgeColor: 'rgba(31,61,43,0.55)',
    dotColor: 'rgba(31,61,43,0.35)',
  },
};

export function toneForHomeworkStatus(status: '완료' | '진행중' | '미완료'): BadgeTone {
  if (status === '완료') return badgePalette.green;
  if (status === '진행중') return badgePalette.gold;
  return badgePalette.gray;
}

export function toneForReportStatus(status: '열람함' | '미열람' | '발송 전'): BadgeTone {
  if (status === '열람함') return badgePalette.green;
  if (status === '미열람') return badgePalette.gold;
  return badgePalette.gray;
}
