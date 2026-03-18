import { redirect } from 'next/navigation';
import { verifyAuth } from '@/lib/api-auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isAuthed = await verifyAuth();
  if (!isAuthed) {
    redirect('/login');
  }
  return <>{children}</>;
}
