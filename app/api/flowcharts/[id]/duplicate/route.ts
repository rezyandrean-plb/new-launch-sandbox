// Next.js API route for duplicating flowcharts
// POST /api/flowcharts/[id]/duplicate - Duplicate a flowchart

import { NextRequest, NextResponse } from "next/server";
import { FlowchartService } from "@/lib/db/flowchart-service";
import pool from "@/lib/db/client";

// Get user ID from request (for now, using a default - implement auth later)
function getUserId(request: NextRequest): string {
  // TODO: Implement actual authentication
  return request.headers.get("x-user-id") || "default-user";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(request);
    const body = await request.json();

    const service = new FlowchartService(pool);
    const duplicated = await service.duplicateFlowchart(
      id,
      userId,
      body.name // Optional new name
    );

    return NextResponse.json(duplicated, { status: 201 });
  } catch (error) {
    console.error("Error duplicating flowchart:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to duplicate flowchart", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
