import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'Montserrat, sans-serif',
      color: '#333'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1>404 - Page Not Found</h1>
        <p>The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" style={{ color: '#007bff', textDecoration: 'none' }}>
          Go back to admin panel
        </Link>
      </div>
    </div>
  );
} 