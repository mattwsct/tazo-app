interface Props {
  params: Promise<{ creator: string }>;
}

export default async function LeaderboardPage({ params }: Props) {
  const { creator } = await params;
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Leaderboard</h1>
        <p style={{ color: '#888' }}>Coming soon for {creator}</p>
      </div>
    </div>
  );
}
