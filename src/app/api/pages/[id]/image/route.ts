import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import path from "path";
import fs from "fs/promises";

const uploadsDir = path.join(process.cwd(), "uploads");

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const page = db
    .prepare("SELECT * FROM pages WHERE id = ?")
    .get(id) as { project_id: string; filename: string } | undefined;

  if (!page) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = path.join(uploadsDir, page.project_id, page.filename);
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(page.filename).slice(1).toLowerCase();
  const contentType = ext === "jpg" ? "jpeg" : ext;

  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": `image/${contentType}` },
  });
}
