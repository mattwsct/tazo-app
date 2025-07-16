// Simple example API route for the App Router
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ name: 'John Doe' });
} 