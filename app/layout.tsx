import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Post-BDA API Client',
  description: 'Configure, save, and run HTTP API calls with variables and parameters.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
