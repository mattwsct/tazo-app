import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Tazo App - Streaming Overlay & Admin',
  description: 'Fullstack streaming overlay and admin tools for Tazo',
  keywords: ['streaming', 'overlay', 'admin', 'obs', 'kick', 'pulsoid'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-900 text-white">
          {children}
        </div>
      </body>
    </html>
  )
} 