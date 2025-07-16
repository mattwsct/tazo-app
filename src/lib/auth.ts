import { NextRequest } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production'
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Generate JWT token for admin authentication
export async function generateAdminToken(): Promise<string> {
  return await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

// Verify admin password and return token
export async function verifyAdminLogin(password: string): Promise<string | null> {
  if (password === ADMIN_PASSWORD) {
    return await generateAdminToken();
  }
  return null;
}

// Verify JWT token from request
export async function verifyAdminToken(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.substring(7);
    const { payload } = await jwtVerify(token, JWT_SECRET);
    
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(identifier: string, maxRequests = 100, windowMs = 60000): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);
  
  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (record.count >= maxRequests) {
    return false;
  }
  
  record.count++;
  return true;
}

// Get client IP for rate limiting
export function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  return 'unknown';
}

// Validate request origin (for public routes like overlay)
export function isValidOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  
  // Allow requests from same origin or no origin (direct access)
  if (!origin && !referer) return true;
  
  const allowedOrigins = [
    'http://localhost:3000',
    'https://localhost:3000',
    // Add your production domains here
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : null,
  ].filter(Boolean);
  
  if (origin && allowedOrigins.some(allowed => allowed && origin.startsWith(allowed))) {
    return true;
  }
  
  if (referer && allowedOrigins.some(allowed => allowed && referer.startsWith(allowed))) {
    return true;
  }
  
  return false;
} 