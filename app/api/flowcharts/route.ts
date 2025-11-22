// Next.js API route for flowchart operations
// GET /api/flowcharts - List flowcharts
// POST /api/flowcharts - Create flowchart

import { NextRequest, NextResponse } from "next/server";
import { FlowchartService } from "@/lib/db/flowchart-service";
import pool from "@/lib/db/client";

// Get user ID from request (for now, using a default - implement auth later)
function getUserId(request: NextRequest): string {
  // TODO: Implement actual authentication
  // For now, return a default user ID
  // You can get this from session, JWT token, etc.
  return request.headers.get("x-user-id") || "default-user";
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserId(request);
    const searchParams = request.nextUrl.searchParams;

    const filters = {
      user_id: userId,
      search: searchParams.get("search") || undefined,
      tags: searchParams.get("tags")?.split(",").filter(Boolean),
      is_template: searchParams.get("is_template") === "true" ? true : undefined,
      limit: parseInt(searchParams.get("limit") || "20"),
      offset: parseInt(searchParams.get("offset") || "0"),
    };

    const service = new FlowchartService(pool);
    const result = await service.listFlowcharts(filters);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error listing flowcharts:", error);
    return NextResponse.json(
      { error: "Failed to list flowcharts", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserId(request);
    const body = await request.json();

    if (!body.name || !body.data) {
      return NextResponse.json(
        { error: "Name and data are required" },
        { status: 400 }
      );
    }

    const service = new FlowchartService(pool);
    const flowchart = await service.createFlowchart({
      user_id: userId,
      name: body.name,
      description: body.description,
      data: body.data,
      tags: body.tags,
      is_public: body.is_public || false,
      is_template: body.is_template || false,
    });

    return NextResponse.json(flowchart, { status: 201 });
  } catch (error) {
    console.error("Error creating flowchart:", error);
    return NextResponse.json(
      { error: "Failed to create flowchart", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
