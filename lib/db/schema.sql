-- Flowchart storage schema for PostgreSQL
-- This schema supports saving, loading, and duplicating flowcharts

CREATE TABLE IF NOT EXISTS flowcharts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL, -- Can be email, auth ID, or session ID
  name VARCHAR(255) NOT NULL,
  description TEXT,
  data JSONB NOT NULL, -- Stores the complete flowchart state (nodes, connections, etc.)
  thumbnail_url TEXT, -- Optional: URL to a thumbnail image
  tags TEXT[], -- Array of tags for categorization
  is_public BOOLEAN DEFAULT false, -- Whether flowchart can be shared publicly
  is_template BOOLEAN DEFAULT false, -- Whether this is a template for duplication
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE, -- Soft delete
  version INTEGER DEFAULT 1 -- For versioning support
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_flowcharts_user_id ON flowcharts(user_id);
CREATE INDEX IF NOT EXISTS idx_flowcharts_created_at ON flowcharts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flowcharts_name ON flowcharts USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_flowcharts_tags ON flowcharts USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_flowcharts_data ON flowcharts USING gin(data jsonb_path_ops); -- For JSON queries
CREATE INDEX IF NOT EXISTS idx_flowcharts_public ON flowcharts(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_flowcharts_template ON flowcharts(is_template) WHERE is_template = true;

-- Version history table (optional, for advanced versioning)
CREATE TABLE IF NOT EXISTS flowchart_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flowchart_id UUID NOT NULL REFERENCES flowcharts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(255) NOT NULL,
  UNIQUE(flowchart_id, version)
);

CREATE INDEX IF NOT EXISTS idx_flowchart_versions_flowchart_id ON flowchart_versions(flowchart_id, version DESC);

-- Sharing table (optional, for collaboration)
CREATE TABLE IF NOT EXISTS flowchart_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flowchart_id UUID NOT NULL REFERENCES flowcharts(id) ON DELETE CASCADE,
  shared_with_user_id VARCHAR(255) NOT NULL,
  permission VARCHAR(20) DEFAULT 'read', -- 'read', 'write', 'admin'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(flowchart_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_flowchart_shares_flowchart_id ON flowchart_shares(flowchart_id);
CREATE INDEX IF NOT EXISTS idx_flowchart_shares_user_id ON flowchart_shares(shared_with_user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_flowcharts_updated_at 
  BEFORE UPDATE ON flowcharts 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

