// TypeScript types for database operations

export type FlowchartData = {
  nodes: FlowchartNode[];
  connections: FlowchartConnection[];
  zoom?: number;
  pan?: { x: number; y: number };
  metadata?: {
    developerPayout?: number;
    nodeValues?: Record<string, { percent?: number; fixed?: number }>;
    nodeNames?: Record<string, string>;
    dynamicChildren?: Record<string, string[]>;
  };
};

export type FlowchartNode = {
  id: string;
  label: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  category: "kw" | "era" | "ps" | "neutral";
  amountType: "percent" | "fixed" | "formula";
  amountValue: number;
  percentValues?: number[];
  fixedValues?: number[];
  percentValue?: number;
  fixedValue?: number;
  usePercent: boolean;
  useFixed: boolean;
  formula?: string;
  parentId: string | null;
  calculatedAmount?: number;
  customText?: string;
  customTextSize?: number;
  customTextBold?: boolean;
  nodeType?: "box" | "text";
};

export type FlowchartConnection = {
  id: string;
  from: string;
  to: string;
};

export type FlowchartRecord = {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  data: FlowchartData;
  thumbnail_url?: string;
  tags?: string[];
  is_public: boolean;
  is_template: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
  version: number;
};

export type CreateFlowchartInput = {
  user_id: string;
  name: string;
  description?: string;
  data: FlowchartData;
  tags?: string[];
  is_public?: boolean;
  is_template?: boolean;
};

export type UpdateFlowchartInput = {
  name?: string;
  description?: string;
  data?: FlowchartData;
  tags?: string[];
  is_public?: boolean;
  is_template?: boolean;
};

export type FlowchartListFilters = {
  user_id?: string;
  search?: string;
  tags?: string[];
  is_public?: boolean;
  is_template?: boolean;
  limit?: number;
  offset?: number;
};

