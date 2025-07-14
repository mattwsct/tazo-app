import { NextRequest, NextResponse } from "next/server";
import { kvFetch } from "../kv";

const SETTINGS_KEY = "overlay_settings";

export async function GET() {
  // Get overlay settings
  const data = await kvFetch(`/get/${SETTINGS_KEY}`);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  // Update overlay settings
  const value = await req.json();
  const data = await kvFetch(`/set/${SETTINGS_KEY}`, "POST", { value });
  return NextResponse.json(data);
} 