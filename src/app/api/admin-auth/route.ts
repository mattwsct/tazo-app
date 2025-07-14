import { NextRequest, NextResponse } from "next/server";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password === ADMIN_PASSWORD) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("admin_auth", "1", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24, // 1 day
      path: "/",
    });
    return res;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
} 