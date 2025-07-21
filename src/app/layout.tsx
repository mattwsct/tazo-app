import "../styles/globals.css";
import { ReactNode } from "react";
import { Montserrat } from "next/font/google";
import { performStartupValidation } from '@/lib/startup';

const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

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
      <body>{children}</body>
    </html>
  );
} 