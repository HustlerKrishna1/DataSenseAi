import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import ChatWidget from '../components/chat-widget';
export const metadata: Metadata = {
  title: 'DataSense AI | Professional Data Workspace',
  description: 'Instant data analysis via AI with SQL, charts, and web search capabilities.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
        <ChatWidget />
      </body>
    </html>
  );
}
