"use client";

import { useState, useRef, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  useDraggable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { payoutNodes, rootNodeId, parentMap } from "@/lib/payout-schema";
import { formatCurrency, formatPercent } from "@/lib/formatters";

type AmountType = "percent" | "fixed" | "formula";

type NodeCategory = "kw" | "era" | "ps" | "neutral";

type FlowchartNode = {
  id: string;
  label: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  category: NodeCategory;
  amountType: AmountType;
  amountValue: number;
  percentValues?: number[]; // Array of percentage values (when percent is enabled)
  fixedValues?: number[]; // Array of fixed dollar values (when fixed is enabled)
  percentValue?: number; // Legacy: single percentage value (for backward compatibility)
  fixedValue?: number; // Legacy: single fixed value (for backward compatibility)
  usePercent: boolean; // Whether to use percentage
  useFixed: boolean; // Whether to use fixed amount
  formula?: string;
  parentId: string | null;
  calculatedAmount?: number;
};

type FlowchartConnection = {
  id: string;
  from: string;
  to: string;
};

type FlowchartCanvasProps = {
  initialData?: any;
};

const categoryColors: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  kw: { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" }, // Yellow
  era: { bg: "#FEE2E2", border: "#EF4444", text: "#991B1B" }, // Red
  ps: { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }, // Blue
  neutral: { bg: "#F3F4F6", border: "#6B7280", text: "#374151" }, // Gray
};

export default function FlowchartCanvas({ initialData }: FlowchartCanvasProps) {
  const [nodes, setNodes] = useState<FlowchartNode[]>([]);
  const [connections, setConnections] = useState<FlowchartConnection[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStart, setConnectionStart] = useState<string | null>(null);
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Form state for node creation/editing
  const [formData, setFormData] = useState({
    label: "",
    description: "",
    amountType: "percent" as AmountType,
    amountValue: 0,
    usePercent: false,
    useFixed: false,
    percentValues: [] as number[],
    fixedValues: [] as number[],
    formula: "",
    parentId: null as string | null,
    category: "neutral" as NodeCategory,
  });

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 8,
    },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      distance: 8,
    },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  // Calculate node amounts based on parent and amount type
  const calculateNodeAmounts = (nodeList: FlowchartNode[]): Record<string, number> => {
    const amounts: Record<string, number> = {};
    
    // Find root nodes (no parent) and set their amounts
    nodeList.forEach((node) => {
      if (!node.parentId) {
        // Root node: use fixed values or amountValue
        if (node.useFixed && node.fixedValues && node.fixedValues.length > 0) {
          amounts[node.id] = node.fixedValues.reduce((sum, val) => sum + val, 0);
        } else if (node.useFixed && node.fixedValue !== undefined) {
          amounts[node.id] = node.fixedValue;
        } else if (node.amountType === "fixed") {
          amounts[node.id] = node.amountValue;
        } else {
          // Default root value
          amounts[node.id] = node.amountValue || 0;
        }
      }
    });

    const compute = (nodeId: string, path: Set<string> = new Set()): number => {
      // Check for circular reference
      if (path.has(nodeId)) {
        console.warn(`Circular reference detected for node: ${nodeId}`);
        amounts[nodeId] = 0;
        return 0;
      }
      
      if (amounts[nodeId] !== undefined) return amounts[nodeId];
      
      const node = nodeList.find((n) => n.id === nodeId);
      if (!node) {
        amounts[nodeId] = 0;
        return 0;
      }

      // Root node (no parent) - already handled above
      if (!node.parentId) {
        if (amounts[nodeId] === undefined) {
          if (node.useFixed && node.fixedValues && node.fixedValues.length > 0) {
            amounts[node.id] = node.fixedValues.reduce((sum, val) => sum + val, 0);
          } else if (node.useFixed && node.fixedValue !== undefined) {
            amounts[node.id] = node.fixedValue;
          } else {
            amounts[node.id] = node.amountValue || 0;
          }
        }
        return amounts[nodeId];
      }

      // Add current node to path to detect cycles
      const newPath = new Set(path);
      newPath.add(nodeId);
      
      const parentAmount = compute(node.parentId, newPath);
      
      let calculated = 0;
      
      // Calculate sum of all percentages
      let percentTotal = 0;
      if (node.usePercent) {
        if (node.percentValues && node.percentValues.length > 0) {
          // Sum all percentage values
          percentTotal = node.percentValues.reduce((sum, val) => sum + val, 0);
        } else if (node.percentValue !== undefined) {
          // Legacy: single percentage value
          percentTotal = node.percentValue;
        }
      }
      
      // Calculate sum of all fixed values
      let fixedTotal = 0;
      if (node.useFixed) {
        if (node.fixedValues && node.fixedValues.length > 0) {
          // Sum all fixed values
          fixedTotal = node.fixedValues.reduce((sum, val) => sum + val, 0);
        } else if (node.fixedValue !== undefined) {
          // Legacy: single fixed value
          fixedTotal = node.fixedValue;
        }
      }
      
      // Calculate final amount based on parent
      if (node.usePercent && node.useFixed) {
        const percentAmount = (parentAmount * percentTotal) / 100;
        calculated = percentAmount + fixedTotal;
      } else if (node.usePercent && percentTotal > 0) {
        calculated = (parentAmount * percentTotal) / 100;
      } else if (node.useFixed && fixedTotal > 0) {
        calculated = fixedTotal;
      } else if (node.amountType === "percent") {
        // Fallback to old format
        calculated = (parentAmount * node.amountValue) / 100;
      } else if (node.amountType === "fixed") {
        // Fallback to old format - but this shouldn't be used for child nodes
        calculated = node.amountValue;
      } else if (node.amountType === "formula" && node.formula) {
        // Simple formula evaluation (for future enhancement)
        // For now, treat as fixed
        calculated = node.amountValue;
      }

      amounts[nodeId] = Math.round(calculated * 100) / 100;
      return amounts[nodeId];
    };

    // Compute all nodes
    nodeList.forEach((node) => compute(node.id));
    return amounts;
  };

  const nodeAmounts = calculateNodeAmounts(nodes);

  // Initialize nodes from commission flow data if available
  useEffect(() => {
    if (initialData && nodes.length === 0) {
      const { developerPayout, nodeValues, nodeNames, dynamicChildren } = initialData;
      
      // Calculate node amounts (similar to commission-flow-diagram)
      const calculatedAmounts: Record<string, number> = {
        [rootNodeId]: developerPayout,
      };

      const compute = (nodeId: string): number => {
        if (calculatedAmounts[nodeId] !== undefined) return calculatedAmounts[nodeId];
        
        const isDynamicChild = nodeId.startsWith("projectLeads_lead_");
        if (isDynamicChild) {
          const { fixed = 0 } = nodeValues[nodeId] ?? {};
          const amount = Math.round(fixed * 100) / 100;
          calculatedAmounts[nodeId] = amount;
          return amount;
        }
        
        const parentId = parentMap[nodeId];
        if (!parentId) {
          calculatedAmounts[nodeId] = 0;
          return 0;
        }
        const parentAmount = compute(parentId);
        const { percent = 0, fixed = 0 } = nodeValues[nodeId] ?? {};
        
        if (nodeId === "taggerFee" && parentId === "taggerCombined") {
          const amount = Math.round((developerPayout * percent + fixed) * 100) / 100;
          calculatedAmounts[nodeId] = amount;
          return amount;
        }
        
        const amount = Math.round((parentAmount * percent + fixed) * 100) / 100;
        calculatedAmounts[nodeId] = amount;
        return amount;
      };

      Object.keys(payoutNodes).forEach(compute);
      if (dynamicChildren) {
        Object.keys(dynamicChildren).forEach((parentId: string) => {
          dynamicChildren[parentId].forEach((childId: string) => {
            compute(childId);
          });
        });
      }

      // Create flowchart nodes from payout nodes
      const flowchartNodes: FlowchartNode[] = [];
      const nodeWidth = 200;
      const nodeHeight = 120;
      const horizontalSpacing = 250;
      const verticalSpacing = 200;

      // Add root node
      const rootTemplate = payoutNodes[rootNodeId];
      if (rootTemplate) {
          flowchartNodes.push({
            id: rootNodeId,
            label: rootTemplate.label,
            description: rootTemplate.description,
            x: 400,
            y: 50,
            width: nodeWidth,
            height: nodeHeight,
            category: "neutral",
            amountType: "fixed",
            amountValue: developerPayout,
            usePercent: false,
            useFixed: true,
            fixedValue: developerPayout,
            parentId: null,
            calculatedAmount: developerPayout,
          });
      }

      // Add child nodes in a hierarchical layout
      const addChildren = (parentId: string, startX: number, startY: number) => {
        const template = payoutNodes[parentId];
        if (!template) return;

        const children = dynamicChildren?.[parentId] || template.childIds || [];
        if (children.length === 0) return;

        const childCount = children.length;
        const totalWidth = childCount * horizontalSpacing;
        const startXPos = startX - totalWidth / 2 + horizontalSpacing / 2;

        children.forEach((childId: string, index: number) => {
          const childTemplate = payoutNodes[childId];
          if (!childTemplate && !childId.startsWith("projectLeads_lead_")) return;

          const isDynamicChild = childId.startsWith("projectLeads_lead_");
          const childNodeTemplate = isDynamicChild
            ? {
                id: childId,
                label: `Lead ${childId.match(/lead_(\d+)/)?.[1] || ""}`,
                description: "Individual IC lead share",
              }
            : childTemplate;

          if (!childNodeTemplate) return;

          const nodeX = startXPos + index * horizontalSpacing;
          const nodeY = startY + verticalSpacing;
          const { percent = 0, fixed = 0 } = nodeValues?.[childId] ?? {};
          
          // Determine category based on node ID patterns
          let category: NodeCategory = "neutral";
          if (childId.includes("kw") || childId.includes("KW") || childId.includes("specialist")) {
            category = "kw";
          } else if (childId.includes("era") || childId.includes("ERA")) {
            category = "era";
          } else if (childId.includes("specialist") || childId.includes("PS")) {
            category = "ps";
          }

          const hasPercent = percent > 0;
          const hasFixed = fixed > 0;
          
          flowchartNodes.push({
            id: childId,
            label: childNodeTemplate.label,
            description: childNodeTemplate.description,
            x: nodeX,
            y: nodeY,
            width: nodeWidth,
            height: nodeHeight,
            category,
            amountType: hasPercent ? "percent" : "fixed",
            amountValue: hasPercent ? percent * 100 : fixed,
            usePercent: hasPercent,
            useFixed: hasFixed,
            percentValues: hasPercent ? [percent * 100] : undefined,
            fixedValues: hasFixed ? [fixed] : undefined,
            formula: "",
            parentId,
            calculatedAmount: calculatedAmounts[childId],
          });

          addChildren(childId, nodeX, nodeY);
        });
      };

      addChildren(rootNodeId, 400, 50);

      // Create connections based on parent-child relationships
      const flowchartConnections: FlowchartConnection[] = [];
      flowchartNodes.forEach((node) => {
        if (node.parentId) {
          flowchartConnections.push({
            id: `conn-${node.parentId}-${node.id}`,
            from: node.parentId,
            to: node.id,
          });
        }
      });

      setNodes(flowchartNodes);
      setConnections(flowchartConnections);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedNodeId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    const nodeId = active.id as string;

    if (delta) {
      setNodes((prevNodes) =>
        prevNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                x: node.x + delta.x / zoom,
                y: node.y + delta.y / zoom,
              }
            : node
        )
      );
    }

    setDraggedNodeId(null);
  };

  const handleNodeClick = (nodeId: string) => {
    if (isConnecting && connectionStart && connectionStart !== nodeId) {
      // Create connection and update parent
      const newConnection: FlowchartConnection = {
        id: `conn-${connectionStart}-${nodeId}`,
        from: connectionStart,
        to: nodeId,
      };
      setConnections((prev) => [...prev, newConnection]);
      
      // Update node's parent
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId ? { ...node, parentId: connectionStart } : node
        )
      );
      
      setIsConnecting(false);
      setConnectionStart(null);
    } else {
      setSelectedNode(nodeId);
    }
  };

  const handleStartConnection = (nodeId: string) => {
    setIsConnecting(true);
    setConnectionStart(nodeId);
    setSelectedNode(nodeId);
  };

  const handleAddNode = () => {
    setEditingNodeId(null);
    setFormData({
      label: "",
      description: "",
      amountType: "percent",
      amountValue: 0,
      usePercent: false,
      useFixed: false,
      percentValues: [],
      fixedValues: [],
      formula: "",
      parentId: null,
      category: "neutral",
    });
    setIsNodeModalOpen(true);
  };

  const handleEditNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      setEditingNodeId(nodeId);
      setFormData({
        label: node.label,
        description: node.description || "",
        amountType: node.amountType,
        amountValue: node.amountValue,
        usePercent: node.usePercent ?? (node.amountType === "percent"),
        useFixed: node.useFixed ?? (node.amountType === "fixed"),
        percentValues: node.percentValues ?? (node.percentValue !== undefined ? [node.percentValue] : []),
        fixedValues: node.fixedValues ?? (node.fixedValue !== undefined ? [node.fixedValue] : []),
        formula: node.formula || "",
        parentId: node.parentId,
        category: node.category,
      });
      setIsNodeModalOpen(true);
    }
  };

  const handleSaveNode = () => {
    if (!formData.label.trim()) return;

    if (editingNodeId) {
      // Update existing node
      setNodes((prev) =>
        prev.map((node) =>
          node.id === editingNodeId
            ? {
                ...node,
                label: formData.label,
                description: formData.description,
                amountType: formData.amountType,
                amountValue: formData.amountValue,
                usePercent: formData.usePercent,
                useFixed: formData.useFixed,
                percentValues: formData.usePercent && formData.percentValues.length > 0 ? formData.percentValues : undefined,
                fixedValues: formData.useFixed && formData.fixedValues.length > 0 ? formData.fixedValues : undefined,
                formula: formData.formula,
                parentId: formData.parentId,
                category: formData.category,
              }
            : node
        )
      );
      
      // Update connections if parent changed
      if (formData.parentId) {
        const parentId = formData.parentId;
        setConnections((prev) => {
          // Remove old connection
          const filtered = prev.filter((c) => c.to !== editingNodeId);
          // Check if new connection exists
          const connectionExists = filtered.some(
            (c) => c.from === parentId && c.to === editingNodeId
          );
          if (!connectionExists) {
            return [
              ...filtered,
              {
                id: `conn-${parentId}-${editingNodeId}`,
                from: parentId,
                to: editingNodeId,
              },
            ];
          }
          return filtered;
        });
      } else {
        // Remove connection if parent is removed
        setConnections((prev) => prev.filter((c) => c.to !== editingNodeId));
      }
    } else {
      // Create new node
      const newNode: FlowchartNode = {
        id: `node-${Date.now()}`,
        label: formData.label,
        description: formData.description,
        x: 300 + Math.random() * 200,
        y: 200 + Math.random() * 200,
        width: 200,
        height: 120,
        category: formData.category,
        amountType: formData.amountType,
        amountValue: formData.amountValue,
        usePercent: formData.usePercent,
        useFixed: formData.useFixed,
        percentValues: formData.usePercent && formData.percentValues.length > 0 ? formData.percentValues : undefined,
        fixedValues: formData.useFixed && formData.fixedValues.length > 0 ? formData.fixedValues : undefined,
        formula: formData.formula,
        parentId: formData.parentId,
      };
      setNodes((prev) => [...prev, newNode]);

      // Create connection if parent is selected
      if (formData.parentId) {
        const parentId = formData.parentId; // Type narrowing
        setConnections((prev) => {
          // Check if connection already exists
          const connectionExists = prev.some(
            (c) => c.from === parentId && c.to === newNode.id
          );
          if (connectionExists) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `conn-${parentId}-${newNode.id}`,
              from: parentId,
              to: newNode.id,
            },
          ];
        });
      }
    }

    setIsNodeModalOpen(false);
    setEditingNodeId(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) =>
      prev.filter((c) => c.from !== nodeId && c.to !== nodeId)
    );
    if (selectedNode === nodeId) {
      setSelectedNode(null);
    }
  };

  const handleDeleteConnection = (connectionId: string) => {
    const connection = connections.find((c) => c.id === connectionId);
    if (connection) {
      // Remove parent relationship
      setNodes((prev) =>
        prev.map((node) =>
          node.id === connection.to ? { ...node, parentId: null } : node
        )
      );
    }
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
  };

  const getConnectionPath = (fromNode: FlowchartNode, toNode: FlowchartNode) => {
    const fromX = fromNode.x * zoom + pan.x + fromNode.width / 2;
    const fromY = fromNode.y * zoom + pan.y + fromNode.height;
    const toX = toNode.x * zoom + pan.x + toNode.width / 2;
    const toY = toNode.y * zoom + pan.y;

    const midY = (fromY + toY) / 2;

    return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
  };

  return (
    <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center gap-4 border-b border-black/10 pb-4">
        <button
          onClick={handleAddNode}
          className="rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
        >
          + Add Node
        </button>
        <button
          onClick={() => {
            setIsConnecting(!isConnecting);
            setConnectionStart(null);
          }}
          className={`rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold transition-colors ${
            isConnecting
              ? "bg-[#B40101] text-white"
              : "bg-white text-black hover:bg-black/5"
          }`}
        >
          {isConnecting ? "Cancel Connection" : "Connect Nodes"}
        </button>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-black/70">Zoom:</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-black/60">{Math.round(zoom * 100)}%</span>
        </div>
        {selectedNode && (
          <>
            <button
              onClick={() => handleEditNode(selectedNode)}
              className="rounded-lg border border-[#B40101] px-4 py-2 text-sm font-semibold text-[#B40101] transition-colors hover:bg-[#B40101]/10"
            >
              Edit Node
            </button>
            <button
              onClick={() => handleDeleteNode(selectedNode)}
              className="ml-auto rounded-lg border border-red-500 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50"
            >
              Delete Selected
            </button>
          </>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative h-[800px] w-full overflow-hidden rounded-xl border border-black/10 bg-[#fafafa] cursor-move"
        style={{
          backgroundImage: `
            linear-gradient(to right, #e5e5e5 1px, transparent 1px),
            linear-gradient(to bottom, #e5e5e5 1px, transparent 1px)
          `,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          cursor: isPanning ? "grabbing" : "grab",
        }}
        onMouseDown={(e) => {
          if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            e.preventDefault();
          }
        }}
        onMouseMove={(e) => {
          if (isPanning) {
            setPan({
              x: e.clientX - panStart.x,
              y: e.clientY - panStart.y,
            });
          }
        }}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom((prev) => Math.max(0.5, Math.min(2, prev * delta)));
          }
        }}
      >
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* SVG for connections */}
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: "100%", height: "100%" }}
          >
            {connections.map((conn) => {
              const fromNode = nodes.find((n) => n.id === conn.from);
              const toNode = nodes.find((n) => n.id === conn.to);
              if (!fromNode || !toNode) return null;

              const path = getConnectionPath(fromNode, toNode);
              return (
                <g key={conn.id}>
                  <path
                    d={path}
                    stroke="#666"
                    strokeWidth="2"
                    fill="none"
                    markerEnd="url(#arrowhead)"
                  />
                  <path
                    d={path}
                    stroke="transparent"
                    strokeWidth="12"
                    fill="none"
                    className="pointer-events-auto cursor-pointer hover:stroke-red-200"
                    onClick={() => handleDeleteConnection(conn.id)}
                  />
                </g>
              );
            })}
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#666" />
              </marker>
            </defs>
          </svg>

          {/* Nodes */}
          {nodes.map((node) => (
            <DraggableNode
              key={node.id}
              node={node}
              zoom={zoom}
              pan={pan}
              isSelected={selectedNode === node.id}
              isDragging={draggedNodeId === node.id}
              calculatedAmount={nodeAmounts[node.id] || 0}
              onClick={() => handleNodeClick(node.id)}
              onStartConnection={() => handleStartConnection(node.id)}
              onEdit={() => handleEditNode(node.id)}
              onDelete={() => handleDeleteNode(node.id)}
            />
          ))}
        </DndContext>
      </div>

      {/* Node Creation/Editing Modal */}
      {isNodeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsNodeModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-black/10 bg-white shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-black/10 flex-shrink-0">
              <h3 className="text-xl font-semibold text-black">
                {editingNodeId ? "Edit Node" : "Create New Node"}
              </h3>
            </div>

            <div className="overflow-y-auto flex-1 p-6">
              <div className="space-y-4">
              {/* Box Name / Role */}
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Box Name / Role <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) =>
                    setFormData({ ...formData, label: e.target.value })
                  }
                  placeholder="e.g., Developer Payout, ERA 0.5% Agency"
                  className="w-full rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                />
              </div>

              {/* Description (optional) */}
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Additional details about this node"
                  rows={2}
                  className="w-full rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                />
              </div>

              {/* Amount Type - Multiple Selection */}
              <div>
                <label className="block text-sm font-medium text-black/70 mb-2">
                  Amount Type <span className="text-red-500">*</span>
                </label>
                <div className="space-y-3">
                  {/* Percentage Checkbox */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.usePercent}
                      onChange={(e) => {
                        const usePercent = e.target.checked;
                        setFormData({
                          ...formData,
                          usePercent,
                          amountType: usePercent && !formData.useFixed ? "percent" : formData.useFixed ? "percent" : formData.amountType,
                        });
                      }}
                      className="w-5 h-5 rounded border-black/20 text-[#B40101] focus:ring-[#B40101] focus:ring-2"
                    />
                    <span className="text-sm font-medium text-black/70">
                      % of parent amount
                    </span>
                  </label>

                  {/* Fixed Amount Checkbox */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.useFixed}
                      onChange={(e) => {
                        const useFixed = e.target.checked;
                        setFormData({
                          ...formData,
                          useFixed,
                          amountType: useFixed && !formData.usePercent ? "fixed" : formData.usePercent ? "fixed" : formData.amountType,
                        });
                      }}
                      className="w-5 h-5 rounded border-black/20 text-[#B40101] focus:ring-[#B40101] focus:ring-2"
                    />
                    <span className="text-sm font-medium text-black/70">
                      Fixed dollar amount
                    </span>
                  </label>
                </div>
                {!formData.usePercent && !formData.useFixed && (
                  <p className="mt-2 text-xs text-red-500">
                    Please select at least one amount type (Percentage or Fixed)
                  </p>
                )}
              </div>

              {/* Percentage Values Input - Multiple */}
              {formData.usePercent && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-black/70">
                      Percentage Values <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          percentValues: [...formData.percentValues, 0],
                        })
                      }
                      className="text-xs text-[#B40101] font-semibold hover:underline"
                    >
                      + Add Percentage
                    </button>
                  </div>
                  {formData.percentValues.length === 0 ? (
                    <p className="text-xs text-black/50 mb-2">
                      Click "+ Add Percentage" to add percentage values
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {formData.percentValues.map((value, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-sm text-black/60 w-8">%</span>
                          <input
                            type="number"
                            step="0.01"
                            value={value}
                            onChange={(e) => {
                              const newValues = [...formData.percentValues];
                              newValues[index] = parseFloat(e.target.value) || 0;
                              setFormData({
                                ...formData,
                                percentValues: newValues,
                              });
                            }}
                            placeholder="e.g., 85"
                            className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newValues = formData.percentValues.filter((_, i) => i !== index);
                              setFormData({
                                ...formData,
                                percentValues: newValues,
                              });
                            }}
                            className="text-red-500 hover:text-red-700 px-2 py-1 text-sm font-semibold"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {formData.percentValues.length > 0 && (
                    <p className="mt-2 text-xs text-black/50">
                      Total: {formData.percentValues.reduce((sum, val) => sum + val, 0).toFixed(2)}%
                    </p>
                  )}
                </div>
              )}

              {/* Fixed Values Input - Multiple */}
              {formData.useFixed && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-black/70">
                      Fixed Dollar Values <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          fixedValues: [...formData.fixedValues, 0],
                        })
                      }
                      className="text-xs text-[#B40101] font-semibold hover:underline"
                    >
                      + Add Fixed Amount
                    </button>
                  </div>
                  {formData.fixedValues.length === 0 ? (
                    <p className="text-xs text-black/50 mb-2">
                      Click "+ Add Fixed Amount" to add fixed dollar values
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {formData.fixedValues.map((value, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-sm text-black/60 w-8">$</span>
                          <input
                            type="number"
                            step="1"
                            value={value}
                            onChange={(e) => {
                              const newValues = [...formData.fixedValues];
                              newValues[index] = parseFloat(e.target.value) || 0;
                              setFormData({
                                ...formData,
                                fixedValues: newValues,
                              });
                            }}
                            placeholder="e.g., 3000"
                            className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newValues = formData.fixedValues.filter((_, i) => i !== index);
                              setFormData({
                                ...formData,
                                fixedValues: newValues,
                              });
                            }}
                            className="text-red-500 hover:text-red-700 px-2 py-1 text-sm font-semibold"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {formData.fixedValues.length > 0 && (
                    <p className="mt-2 text-xs text-black/50">
                      Total: {formatCurrency(formData.fixedValues.reduce((sum, val) => sum + val, 0))}
                    </p>
                  )}
                </div>
              )}

              {/* Combined Preview */}
              {formData.usePercent && formData.useFixed && formData.parentId && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                  <p className="text-xs font-medium text-blue-900 mb-1">
                    Calculation Preview:
                  </p>
                  <p className="text-xs text-blue-700">
                    (Parent Amount × {formData.percentValues.reduce((sum, val) => sum + val, 0).toFixed(2)}%) + {formatCurrency(formData.fixedValues.reduce((sum, val) => sum + val, 0))}
                  </p>
                </div>
              )}

              {/* Parent Node Selection */}
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Parent Node
                </label>
                <select
                  value={formData.parentId || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      parentId: e.target.value || null,
                    })
                  }
                  className="w-full rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                >
                  <option value="">None (Root Node)</option>
                  {nodes
                    .filter((n) => n.id !== editingNodeId)
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-black/50">
                  Select a parent node to attach this box under. Amount will auto-recalculate based on parent's value.
                </p>
              </div>

              {/* Display Color / Category */}
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Display Color / Category
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["kw", "era", "ps", "neutral"] as NodeCategory[]).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, category: cat })
                      }
                      className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold transition-all ${
                        formData.category === cat
                          ? "border-black ring-2 ring-offset-2"
                          : "border-black/20"
                      }`}
                      style={{
                        backgroundColor: categoryColors[cat].bg,
                        color: categoryColors[cat].text,
                        borderColor:
                          formData.category === cat
                            ? categoryColors[cat].border
                            : undefined,
                      }}
                    >
                      {cat.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-black/50">
                  KW (Yellow), ERA (Red), PS (Blue), Neutral (Gray)
                </p>
              </div>
              </div>
            </div>

            <div className="p-6 border-t border-black/10 flex-shrink-0 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsNodeModalOpen(false);
                  setEditingNodeId(null);
                }}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNode}
                disabled={
                  !formData.label.trim() ||
                  (!formData.usePercent && !formData.useFixed) ||
                  (formData.usePercent && formData.percentValues.length === 0) ||
                  (formData.useFixed && formData.fixedValues.length === 0)
                }
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingNodeId ? "Save Changes" : "Create Node"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type DraggableNodeProps = {
  node: FlowchartNode;
  zoom: number;
  pan: { x: number; y: number };
  isSelected: boolean;
  isDragging: boolean;
  calculatedAmount: number;
  onClick: () => void;
  onStartConnection: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function DraggableNode({
  node,
  zoom,
  pan,
  isSelected,
  isDragging,
  calculatedAmount,
  onClick,
  onStartConnection,
  onEdit,
  onDelete,
}: DraggableNodeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
  } = useDraggable({
    id: node.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const categoryColor = categoryColors[node.category];
  const position = {
    left: node.x * zoom + pan.x,
    top: node.y * zoom + pan.y,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        position: "absolute",
        ...position,
        width: node.width * zoom,
        height: node.height * zoom,
        zIndex: isDragging ? 50 : isSelected ? 10 : 1,
      }}
      className={`group cursor-move ${isDragging ? "opacity-80" : ""}`}
    >
      <div
        className={`h-full rounded-xl border-2 bg-white p-3 shadow-md transition-all ${
          isSelected
            ? "ring-2 ring-[#B40101] ring-offset-2"
            : "border-black/10"
        }`}
        style={{
          borderLeftColor: categoryColor.border,
          borderLeftWidth: "4px",
          backgroundColor: categoryColor.bg,
        }}
        onClick={onClick}
      >
        <div className="flex h-full flex-col justify-between">
          <div
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing flex-1"
          >
            <h3
              className="text-xs font-semibold uppercase tracking-wide"
              style={{
                fontSize: `${12 * zoom}px`,
                color: categoryColor.text,
              }}
            >
              {node.label}
            </h3>
            {node.description && (
              <p
                className="mt-1 text-xs"
                style={{
                  fontSize: `${10 * zoom}px`,
                  color: categoryColor.text,
                  opacity: 0.7,
                }}
              >
                {node.description}
              </p>
            )}
            {calculatedAmount > 0 && (
              <p
                className="mt-2 text-lg font-semibold"
                style={{
                  fontSize: `${16 * zoom}px`,
                  color: categoryColor.text,
                }}
              >
                {formatCurrency(calculatedAmount)}
              </p>
            )}
            <p
              className="mt-1 text-xs"
              style={{
                fontSize: `${10 * zoom}px`,
                color: categoryColor.text,
                opacity: 0.7,
              }}
            >
              {(() => {
                const percentTotal = node.percentValues?.reduce((sum, val) => sum + val, 0) ?? 
                                   (node.percentValue ?? 0);
                const fixedTotal = node.fixedValues?.reduce((sum, val) => sum + val, 0) ?? 
                                 (node.fixedValue ?? 0);
                
                if (node.usePercent && node.useFixed) {
                  const percentDisplay = node.percentValues && node.percentValues.length > 1
                    ? `${node.percentValues.join("% + ")}%`
                    : `${percentTotal}%`;
                  const fixedDisplay = node.fixedValues && node.fixedValues.length > 1
                    ? `+ ${node.fixedValues.map(v => formatCurrency(v)).join(" + ")}`
                    : `+ ${formatCurrency(fixedTotal)}`;
                  return `${percentDisplay} ${fixedDisplay}`;
                } else if (node.usePercent && percentTotal > 0) {
                  if (node.percentValues && node.percentValues.length > 1) {
                    return `${node.percentValues.join("% + ")}% of parent`;
                  }
                  return `${percentTotal}% of parent`;
                } else if (node.useFixed && fixedTotal > 0) {
                  if (node.fixedValues && node.fixedValues.length > 1) {
                    return `Fixed: ${node.fixedValues.map(v => formatCurrency(v)).join(" + ")}`;
                  }
                  return `Fixed: ${formatCurrency(fixedTotal)}`;
                } else if (node.amountType === "percent") {
                  return `${node.amountValue}% of parent`;
                } else if (node.amountType === "fixed") {
                  return `Fixed: ${formatCurrency(node.amountValue)}`;
                }
                return "No amount set";
              })()}
            </p>
          </div>
          <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartConnection();
              }}
              className="rounded bg-[#B40101] px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-[#950101] pointer-events-auto z-10 relative"
              style={{ fontSize: `${10 * zoom}px` }}
            >
              Connect
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="rounded bg-blue-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-blue-600 pointer-events-auto z-10 relative"
              style={{ fontSize: `${10 * zoom}px` }}
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded bg-red-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-red-600 pointer-events-auto z-10 relative"
              style={{ fontSize: `${10 * zoom}px` }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
