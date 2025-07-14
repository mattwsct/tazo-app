import { NextRequest, NextResponse } from "next/server";

const KV_URL = process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.VERCEL_KV_REST_API_TOKEN;

export async function kvFetch(path: string, method = "GET", body?: any) {
  const url = `${KV_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${KV_TOKEN}`,
    "Content-Type": "application/json",
  };
  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  return res.json();
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  const data = await kvFetch(`/get/${key}`);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { key, value } = await req.json();
  if (!key || value === undefined) return NextResponse.json({ error: "Missing key or value" }, { status: 400 });
  const data = await kvFetch(`/set/${key}`, "POST", { value });
  return NextResponse.json(data);
} 