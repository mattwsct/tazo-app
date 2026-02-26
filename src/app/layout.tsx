import "../styles/globals.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import { ReactNode } from "react";
import { performStartupValidation } from '@/lib/startup';

export const metadata = {
  title: "IRL Stream Overlay",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Perform startup validation (only in development)
  if (process.env.NODE_ENV === 'development') {
    performStartupValidation();
  }
  
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://flagcdn.com" />
        <link rel="preconnect" href="https://api.open-meteo.com" />
      </head>
      <body>{children}</body>
    </html>
  );
} 