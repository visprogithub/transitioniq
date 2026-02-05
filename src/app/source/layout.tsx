import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TransitionIQ — Source Code',
  robots: { index: false, follow: false },
};

export default function SourceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
