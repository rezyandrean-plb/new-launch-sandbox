// Database service for flowchart operations using PostgreSQL
import { Pool } from "pg";
import type {
  FlowchartRecord,
  FlowchartData,
  CreateFlowchartInput,
  UpdateFlowchartInput,
  FlowchartListFilters,
} from "./types";

export class FlowchartService {
  private client: Pool;

  constructor(client: Pool) {
    this.client = client;
  }

  /**
   * Create a new flowchart
   */
  async createFlowchart(input: CreateFlowchartInput): Promise<FlowchartRecord> {
    const query = `
      INSERT INTO flowcharts (user_id, name, description, data, tags, is_public, is_template)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      input.user_id,
      input.name,
      input.description || null,
      JSON.stringify(input.data),
      input.tags || [],
      input.is_public || false,
      input.is_template || false,
    ];
    const result = await this.client.query(query, values);
    return this.mapToFlowchartRecord(result.rows[0]);
  }

  /**
   * Get a flowchart by ID
   */
  async getFlowchartById(id: string, userId?: string): Promise<FlowchartRecord | null> {
    const query = `
      SELECT * FROM flowcharts
      WHERE id = $1
        AND deleted_at IS NULL
        AND (user_id = $2 OR is_public = true OR $2 IS NULL)
    `;
    const result = await this.client.query(query, [id, userId || null]);
    return result.rows.length > 0 ? this.mapToFlowchartRecord(result.rows[0]) : null;
  }

  /**
   * Update a flowchart
   */
  async updateFlowchart(
    id: string,
    userId: string,
    input: UpdateFlowchartInput
  ): Promise<FlowchartRecord> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.data !== undefined) {
      updates.push(`data = $${paramIndex++}`);
      values.push(JSON.stringify(input.data));
      updates.push(`version = version + 1`);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(input.tags);
    }
    if (input.is_public !== undefined) {
      updates.push(`is_public = $${paramIndex++}`);
      values.push(input.is_public);
    }
    if (input.is_template !== undefined) {
      updates.push(`is_template = $${paramIndex++}`);
      values.push(input.is_template);
    }

    if (updates.length === 0) {
      // No updates, just return the existing record
      const existing = await this.getFlowchartById(id, userId);
      if (!existing) {
        throw new Error("Flowchart not found");
      }
      return existing;
    }

    values.push(id, userId);

    const query = `
      UPDATE flowcharts
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex++} AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await this.client.query(query, values);
    if (result.rows.length === 0) {
      throw new Error("Flowchart not found or unauthorized");
    }
    return this.mapToFlowchartRecord(result.rows[0]);
  }

  /**
   * Delete a flowchart (soft delete)
   */
  async deleteFlowchart(id: string, userId: string): Promise<void> {
    const query = `
      UPDATE flowcharts
      SET deleted_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    `;
    const result = await this.client.query(query, [id, userId]);
    if (result.rowCount === 0) {
      throw new Error("Flowchart not found or unauthorized");
    }
  }

  /**
   * List flowcharts with filters
   */
  async listFlowcharts(filters: FlowchartListFilters): Promise<{
    flowcharts: FlowchartRecord[];
    total: number;
  }> {
    const conditions: string[] = ["deleted_at IS NULL"];
    const values: any[] = [];
    let paramIndex = 1;

    if (filters.user_id) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(filters.user_id);
    }
    if (filters.search) {
      conditions.push(`to_tsvector('english', name) @@ plainto_tsquery('english', $${paramIndex++})`);
      values.push(filters.search);
    }
    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`tags && $${paramIndex++}`);
      values.push(filters.tags);
    }
    if (filters.is_public !== undefined) {
      conditions.push(`is_public = $${paramIndex++}`);
      values.push(filters.is_public);
    }
    if (filters.is_template !== undefined) {
      conditions.push(`is_template = $${paramIndex++}`);
      values.push(filters.is_template);
    }

    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    const query = `
      SELECT *, COUNT(*) OVER() as total
      FROM flowcharts
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    values.push(limit, offset);

    const result = await this.client.query(query, values);
    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;

    return {
      flowcharts: result.rows.map((row) => this.mapToFlowchartRecord(row)),
      total,
    };
  }

  /**
   * Duplicate a flowchart
   */
  async duplicateFlowchart(
    sourceId: string,
    userId: string,
    newName?: string
  ): Promise<FlowchartRecord> {
    // For duplication, we allow duplicating any flowchart (not just user's own)
    // First try with user restriction, then without if not found
    let source = await this.getFlowchartById(sourceId, userId);
    
    // If not found with user restriction, try without restriction (for public flowcharts or cross-user duplication)
    if (!source) {
      const query = `
        SELECT * FROM flowcharts
        WHERE id = $1 AND deleted_at IS NULL
      `;
      const result = await this.client.query(query, [sourceId]);
      if (result.rows.length > 0) {
        source = this.mapToFlowchartRecord(result.rows[0]);
      }
    }
    
    if (!source) {
      throw new Error("Source flowchart not found");
    }

    const duplicateName = newName || `${source.name} (Copy)`;

    const query = `
      INSERT INTO flowcharts (user_id, name, description, data, tags, is_public, is_template)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      userId,
      duplicateName,
      source.description,
      JSON.stringify(source.data), // Copy the data
      source.tags,
      false, // Duplicates are private by default
      false, // Duplicates are not templates by default
    ];

    const result = await this.client.query(query, values);
    return this.mapToFlowchartRecord(result.rows[0]);
  }

  /**
   * Helper to map database row to FlowchartRecord
   */
  private mapToFlowchartRecord(row: any): FlowchartRecord {
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      description: row.description,
      data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
      thumbnail_url: row.thumbnail_url,
      tags: row.tags || [],
      is_public: row.is_public,
      is_template: row.is_template,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      version: row.version,
    };
  }
}
