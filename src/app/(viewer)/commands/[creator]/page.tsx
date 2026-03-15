import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ creator: string }>;
}

/**
 * /commands/[creator] — multi-creator commands routing.
 * For now only 'tazo' is supported — redirects to the canonical /commands page.
 * Future creators will have their own command sets served here.
 */
export default async function CreatorCommandsPage({ params }: Props) {
  const { creator } = await params;

  if (creator === 'tazo') {
    redirect('/commands');
  }

  // Stub for future creators
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <p className="text-zinc-500 text-sm uppercase tracking-widest font-semibold">Chat Commands</p>
        <h1 className="text-3xl font-bold text-white">{creator}</h1>
        <p className="text-zinc-500">Commands coming soon for this creator.</p>
      </div>
    </div>
  );
}
