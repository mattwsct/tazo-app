import { NextRequest, NextResponse } from "next/server";
import { kvFetch } from "../kv";

const OVERLAY_KEY = "overlay_data";

export async function GET() {
  // Get last known overlay data
  const data = await kvFetch(`/get/${OVERLAY_KEY}`);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  // Update overlay data
  const value = await req.json();
  const data = await kvFetch(`/set/${OVERLAY_KEY}`, "POST", { value });
  return NextResponse.json(data);
} 