// Next.js API route for individual flowchart operations
// GET /api/flowcharts/[id] - Get flowchart
// PUT /api/flowcharts/[id] - Update flowchart
// DELETE /api/flowcharts/[id] - Delete flowchart

import { NextRequest, NextResponse } from "next/server";
import { FlowchartService } from "@/lib/db/flowchart-service";
import pool from "@/lib/db/client";

// Get user ID from request (for now, using a default - implement auth later)
function getUserId(request: NextRequest): string {
  // TODO: Implement actual authentication
  return request.headers.get("x-user-id") || "default-user";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(request);
    const service = new FlowchartService(pool);
    const flowchart = await service.getFlowchartById(id, userId);

    if (!flowchart) {
      return NextResponse.json(
        { error: "Flowchart not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(flowchart);
  } catch (error) {
    console.error("Error getting flowchart:", error);
    return NextResponse.json(
      { error: "Failed to get flowchart", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(request);
    const body = await request.json();

    const service = new FlowchartService(pool);
    const flowchart = await service.updateFlowchart(id, userId, {
      name: body.name,
      description: body.description,
      data: body.data,
      tags: body.tags,
      is_public: body.is_public,
      is_template: body.is_template,
    });

    return NextResponse.json(flowchart);
  } catch (error) {
    console.error("Error updating flowchart:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update flowchart", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(request);
    const service = new FlowchartService(pool);
    await service.deleteFlowchart(id, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting flowchart:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to delete flowchart", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
