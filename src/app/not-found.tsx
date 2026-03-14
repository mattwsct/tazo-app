import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #09090b, #18181b, #09090b)',
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <div>
        <p style={{ fontSize: '5rem', margin: '0 0 1rem' }}>404</p>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Page not found</h1>
        <p style={{ color: '#a1a1aa', marginBottom: '2rem' }}>This page doesn&apos;t exist or has moved.</p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/" style={{
            padding: '0.6rem 1.4rem',
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            borderRadius: '0.75rem',
            textDecoration: 'none',
            fontWeight: 500,
          }}>
            Home
          </Link>
          <Link href="/admin" style={{
            padding: '0.6rem 1.4rem',
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            borderRadius: '0.75rem',
            textDecoration: 'none',
            fontWeight: 500,
          }}>
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
