import "../styles/globals.css";
import { ReactNode } from "react";
import { Montserrat } from "next/font/google";
import { performStartupValidation } from '@/lib/startup';

// Font configuration - preload warning is harmless (font loads normally, just not immediately used due to fade-in delay)
const montserrat = Montserrat({ 
  subsets: ["latin"], 
  weight: ["400", "500", "600"], 
  display: "swap"
  // Note: Preload warning appears because overlay has 1.5s fade-in delay, but font still loads correctly
});

export const metadata = {
  title: "IRL Stream Overlay",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Perform startup validation (only in development)
  if (process.env.NODE_ENV === 'development') {
    performStartupValidation();
  }
  
  return (
    <html lang="en" className={montserrat.className}>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://flagcdn.com" />
        <link rel="preconnect" href="https://api.open-meteo.com" />
      </head>
      <body>{children}</body>
    </html>
  );
} 