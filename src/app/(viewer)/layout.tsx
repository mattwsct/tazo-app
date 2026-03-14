import '@/styles/marketing.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} font-sans min-h-screen bg-zinc-950 text-white`}>
      {children}
    </div>
  );
}
