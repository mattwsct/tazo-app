interface Props {
  params: Promise<{ creator: string; viewer: string }>;
}

export default async function ViewerProfilePage({ params }: Props) {
  const { creator, viewer } = await params;
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Viewer Profile</h1>
        <p style={{ color: '#888' }}>{viewer} in {creator}&apos;s channel</p>
        <p style={{ color: '#555', marginTop: '0.5rem', fontSize: '0.9rem' }}>Stats coming soon</p>
      </div>
    </div>
  );
}
