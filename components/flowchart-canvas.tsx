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
import { useFlowchartSave } from "@/lib/hooks/use-flowchart-save";
import toast from "react-hot-toast";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

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
  kw: { bg: "#E6DFAF", border: "#F59E0B", text: "#92400E" }, // Yellow
  era: { bg: "#FEE2E2", border: "#EF4444", text: "#991B1B" }, // Red
  ps: { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }, // Blue
  neutral: { bg: "#F3F4F6", border: "#6B7280", text: "#374151" }, // Gray
};

const categoryDisplayNames: Record<NodeCategory, string> = {
  kw: "Yellow",
  era: "Red",
  ps: "Blue",
  neutral: "Neutral",
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
  
  // Save/Load state
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isNewFlowchartModalOpen, setIsNewFlowchartModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [savedFlowcharts, setSavedFlowcharts] = useState<any[]>([]);
  const [currentFlowchartId, setCurrentFlowchartId] = useState<string | null>(null);
  const [currentFlowchartName, setCurrentFlowchartName] = useState<string>("Untitled Flowchart");
  const [isEditingName, setIsEditingName] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false); // Track if initial data has been loaded
  const [saveFormData, setSaveFormData] = useState({
    name: "",
    description: "",
    tags: [] as string[],
  });
  
  const { saveFlowchart, updateFlowchart, duplicateFlowchart, deleteFlowchart, isSaving, error } = useFlowchartSave();

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

  // Track raw input strings to allow typing "0" and continuing
  const [percentInputStrings, setPercentInputStrings] = useState<string[]>([]);
  const [fixedInputStrings, setFixedInputStrings] = useState<string[]>([]);

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
    if (initialData && nodes.length === 0 && !hasInitialized) {
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
      setHasInitialized(true);
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

  const handleNodeClick = (nodeId: string, e?: React.MouseEvent) => {
    // Prevent opening edit modal if clicking on buttons inside the node
    if (e && (e.target as HTMLElement).closest('button')) {
      return;
    }

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
      // Open edit modal directly when clicking on node
      setSelectedNode(nodeId);
      handleEditNode(nodeId);
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
      percentValues: [0], // Always start with one field
      fixedValues: [0], // Always start with one field
      formula: "",
      parentId: null,
      category: "neutral",
    });
    setPercentInputStrings([""]);
    setFixedInputStrings([""]);
    setIsNodeModalOpen(true);
  };

  const handleEditNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      setEditingNodeId(nodeId);
      const percentValues = node.percentValues ?? (node.percentValue !== undefined ? [node.percentValue] : []);
      const fixedValues = node.fixedValues ?? (node.fixedValue !== undefined ? [node.fixedValue] : []);
      // Always ensure at least one field exists for each type
      const finalPercentValues = percentValues.length === 0 ? [0] : percentValues;
      const finalFixedValues = fixedValues.length === 0 ? [0] : fixedValues;
      setFormData({
        label: node.label,
        description: node.description || "",
        amountType: node.amountType,
        amountValue: node.amountValue,
        usePercent: node.usePercent ?? (node.amountType === "percent"),
        useFixed: node.useFixed ?? (node.amountType === "fixed"),
        percentValues: finalPercentValues,
        fixedValues: finalFixedValues,
        formula: node.formula || "",
        parentId: node.parentId,
        category: node.category,
      });
      // Initialize input strings from values
      setPercentInputStrings(finalPercentValues.map(v => v === 0 ? "" : String(v)));
      setFixedInputStrings(finalFixedValues.map(v => v === 0 ? "" : String(v)));
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

  const handleDuplicateNode = (nodeId: string) => {
    const nodeToDuplicate = nodes.find((n) => n.id === nodeId);
    if (nodeToDuplicate) {
      const duplicatedNode: FlowchartNode = {
        ...nodeToDuplicate,
        id: `node-${Date.now()}`,
        x: nodeToDuplicate.x + 50, // Offset slightly to the right
        y: nodeToDuplicate.y + 50, // Offset slightly down
        parentId: null, // Remove parent relationship for duplicate
      };
      setNodes((prev) => [...prev, duplicatedNode]);
      
      // Note: We don't duplicate connections, as the duplicate is a new independent node
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

  // Save flowchart handlers
  const handleSaveClick = () => {
    if (currentFlowchartId) {
      // Update existing flowchart
      handleUpdateFlowchart();
    } else {
      // Save new flowchart
      setIsSaveModalOpen(true);
      setSaveFormData({
        name: `Flowchart ${new Date().toLocaleDateString()}`,
        description: "",
        tags: [],
      });
    }
  };

  const handleSaveFlowchart = async () => {
    if (!saveFormData.name.trim()) {
      toast.error("Please enter a name for your flowchart");
      return;
    }

    const savePromise = async () => {
      const flowchartData = {
        nodes,
        connections,
        zoom,
        pan,
        metadata: initialData,
      };

      const result = await saveFlowchart(
        flowchartData,
        saveFormData.name,
        saveFormData.description || undefined,
        saveFormData.tags.length > 0 ? saveFormData.tags : undefined
      );

      setCurrentFlowchartId(result.id);
      const savedName = result.name || saveFormData.name;
      setCurrentFlowchartName(savedName);
      setSaveFormData({ ...saveFormData, name: savedName });
      setIsSaveModalOpen(false);
      return result;
    };

    toast.promise(
      savePromise(),
      {
        loading: 'Saving flowchart...',
        success: 'Flowchart saved successfully!',
        error: (err) => `Failed to save flowchart: ${err instanceof Error ? err.message : "Unknown error"}`,
      }
    );
  };

  const handleUpdateFlowchart = async () => {
    if (!currentFlowchartId) return;

    const updatePromise = async () => {
      const flowchartData = {
        nodes,
        connections,
        zoom,
        pan,
        metadata: initialData,
      };

      const result = await updateFlowchart(
        currentFlowchartId,
        flowchartData,
        saveFormData.name || currentFlowchartName || undefined,
        saveFormData.description || undefined
      );
      
      // Update displayed name if name was updated
      if (result.name) {
        setCurrentFlowchartName(result.name);
        setSaveFormData({ ...saveFormData, name: result.name });
      }
      
      return result;
    };

    toast.promise(
      updatePromise(),
      {
        loading: 'Updating flowchart...',
        success: 'Flowchart updated successfully!',
        error: (err) => `Failed to update flowchart: ${err instanceof Error ? err.message : "Unknown error"}`,
      }
    );
  };

  const handleLoadFlowcharts = async () => {
    try {
      const response = await fetch("/api/flowcharts");
      if (response.ok) {
        const data = await response.json();
        setSavedFlowcharts(data.flowcharts || []);
        setIsLoadModalOpen(true);
      } else {
        // Fallback to localStorage if API not available
        loadFromLocalStorage();
      }
    } catch (err) {
      // Fallback to localStorage on network errors
      loadFromLocalStorage();
    }
  };

  const loadFromLocalStorage = () => {
    const stored = localStorage.getItem("savedFlowcharts");
    if (stored) {
      try {
        const flowcharts = JSON.parse(stored);
        setSavedFlowcharts(flowcharts);
        setIsLoadModalOpen(true);
      } catch (err) {
        console.error("Error parsing saved flowcharts:", err);
        toast.error("Error loading saved flowcharts");
      }
    } else {
      toast.error("No saved flowcharts found");
    }
  };

  const handleLoadFlowchart = (flowchart: any) => {
    const data = flowchart.data;
    if (data.nodes) setNodes(data.nodes);
    if (data.connections) setConnections(data.connections);
    if (data.zoom) setZoom(data.zoom);
    if (data.pan) setPan(data.pan);
    setCurrentFlowchartId(flowchart.id);
    setCurrentFlowchartName(flowchart.name || "Untitled Flowchart");
    setSaveFormData({ ...saveFormData, name: flowchart.name || "" });
    setIsLoadModalOpen(false);
    toast.success(`Loaded flowchart: ${flowchart.name}`);
  };

  const formatDate = (dateString: string | Date): string => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    const day = date.getDate().toString().padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const handleDeleteFlowchart = async (flowchartId: string, flowchartName: string) => {
    if (!confirm(`Are you sure you want to delete "${flowchartName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteFlowchart(flowchartId);
      // Reload the flowcharts list
      await handleLoadFlowcharts();
      toast.success(`Flowchart "${flowchartName}" deleted successfully`);
    } catch (err) {
      console.error("Error deleting flowchart:", err);
      toast.error(`Failed to delete flowchart: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDuplicateFlowchart = async () => {
    if (!currentFlowchartId) {
      toast.error("No flowchart loaded to duplicate");
      return;
    }

    const duplicatePromise = async () => {
      const result = await duplicateFlowchart(
        currentFlowchartId,
        `${saveFormData.name || "Flowchart"} (Copy)`
      );

      // Load the duplicated flowchart
      const flowchartData = result.data;
      if (flowchartData.nodes) setNodes(flowchartData.nodes);
      if (flowchartData.connections) setConnections(flowchartData.connections);
      if (flowchartData.zoom) setZoom(flowchartData.zoom);
      if (flowchartData.pan) setPan(flowchartData.pan);
      setCurrentFlowchartId(result.id);
      setCurrentFlowchartName(result.name || "Untitled Flowchart");
      setSaveFormData({ ...saveFormData, name: result.name });

      return result;
    };

    toast.promise(
      duplicatePromise(),
      {
        loading: 'Duplicating flowchart...',
        success: 'Flowchart duplicated successfully!',
        error: (err) => `Failed to duplicate flowchart: ${err instanceof Error ? err.message : "Unknown error"}`,
      }
    );
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    // Check if there are nodes or connections
    if (nodes.length > 0 || connections.length > 0) {
      return true;
    }
    // Check if zoom or pan has changed from defaults
    if (zoom !== 1 || pan.x !== 0 || pan.y !== 0) {
      return true;
    }
    return false;
  };

  const handleNewFlowchart = () => {
    // Check if there are unsaved changes
    if (hasUnsavedChanges()) {
      setIsNewFlowchartModalOpen(true);
    } else {
      // No changes, proceed directly
      createNewFlowchart();
    }
  };

  const createNewFlowchart = () => {
    setNodes([]);
    setConnections([]);
    setCurrentFlowchartId(null);
    setCurrentFlowchartName("Untitled Flowchart");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSaveFormData({ name: "", description: "", tags: [] });
    setSelectedNode(null);
    setIsConnecting(false);
    setConnectionStart(null);
    setIsNewFlowchartModalOpen(false);
    setHasInitialized(true); // Mark as initialized to prevent reloading initialData
  };

  const handleNameChange = async (newName: string) => {
    setCurrentFlowchartName(newName);
    setSaveFormData({ ...saveFormData, name: newName });
    
    // Auto-save name if flowchart is already saved
    if (currentFlowchartId && newName.trim()) {
      try {
        await updateFlowchart(
          currentFlowchartId,
          {
            nodes,
            connections,
            zoom,
            pan,
            metadata: initialData,
          },
          newName,
          saveFormData.description
        );
      } catch (err) {
        console.error("Error updating flowchart name:", err);
        // Don't show error toast for auto-save, just log it
      }
    }
  };

  const handleNameBlur = () => {
    setIsEditingName(false);
    // Ensure name is not empty
    if (!currentFlowchartName.trim()) {
      setCurrentFlowchartName("Untitled Flowchart");
      setSaveFormData({ ...saveFormData, name: "" });
    }
  };

  // Export flowchart handlers
  const handleExportClick = async () => {
    if (nodes.length === 0) {
      toast.error("No flowchart to export");
      return;
    }

    setIsExporting(true);
    try {
      // Capture the canvas area
      const canvasElement = canvasRef.current;
      if (!canvasElement) {
        toast.error("Could not find canvas element");
        return;
      }

      // Store original background style
      const originalBackgroundImage = canvasElement.style.backgroundImage;
      
      // Temporarily remove grid background for export
      canvasElement.style.backgroundImage = "none";
      canvasElement.style.backgroundColor = "#ffffff";

      // Use html2canvas to capture the flowchart
      const canvas = await html2canvas(canvasElement, {
        backgroundColor: "#ffffff", // White background instead of grid
        scale: 2, // Higher quality
        logging: false,
        useCORS: true,
        allowTaint: true,
      });

      // Restore original background
      canvasElement.style.backgroundImage = originalBackgroundImage;
      canvasElement.style.backgroundColor = "#fafafa";

      // Convert to image data URL
      const dataUrl = canvas.toDataURL("image/png");
      setExportPreview(dataUrl);
      setIsExportModalOpen(true);
    } catch (error) {
      console.error("Error generating export preview:", error);
      toast.error("Failed to generate export preview");
      // Restore background in case of error
      if (canvasRef.current) {
        canvasRef.current.style.backgroundImage = `
          linear-gradient(to right, #e5e5e5 1px, transparent 1px),
          linear-gradient(to bottom, #e5e5e5 1px, transparent 1px)
        `;
        canvasRef.current.style.backgroundColor = "#fafafa";
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadExport = (format: "png" | "pdf" = "png") => {
    if (!exportPreview) {
      toast.error("No preview available");
      return;
    }

    const fileName = saveFormData.name || currentFlowchartName || "flowchart";
    
    if (format === "pdf") {
      // Create PDF using jsPDF
      const flowchartImg = new Image();
      const logoImg = new Image();
      
      // Load logo first
      logoImg.crossOrigin = "anonymous";
      logoImg.onload = () => {
        flowchartImg.onload = () => {
          try {
            // A4 dimensions in mm (portrait)
            const pageWidth = 210;
            const pageHeight = 297;
            
            // Header section dimensions
            const logoHeight = 15; // mm - smaller logo
            const logoWidth = (logoImg.width / logoImg.height) * logoHeight;
            const spacing = 4; // mm - reduced spacing between logo, title, and subtitle
            const headerPadding = 5; // mm top padding
            const titleHeight = 6; // mm for title
            const subtitleHeight = 5; // mm for subtitle
            const totalHeaderHeight = headerPadding + logoHeight + spacing + titleHeight + spacing + subtitleHeight + spacing;
            
            // Available space for flowchart
            const availableHeight = pageHeight - totalHeaderHeight - 10; // 10mm bottom margin
            const availableWidth = pageWidth - 20; // 10mm margins on each side
            
            // Calculate flowchart dimensions to fit available space
            const flowchartAspectRatio = flowchartImg.width / flowchartImg.height;
            let flowchartWidth, flowchartHeight;
            
            if (flowchartAspectRatio > (availableWidth / availableHeight)) {
              // Flowchart is wider - fit to width
              flowchartWidth = availableWidth;
              flowchartHeight = availableWidth / flowchartAspectRatio;
            } else {
              // Flowchart is taller - fit to height
              flowchartHeight = availableHeight;
              flowchartWidth = availableHeight * flowchartAspectRatio;
            }
            
            // Create PDF in portrait mode
            const pdf = new jsPDF({
              orientation: "portrait",
              unit: "mm",
              format: "a4",
            });

            let yPosition = headerPadding;
            
            // Add logo (centered) - preserve transparency and quality
            const logoX = (pageWidth - logoWidth) / 2;
            // Convert logo to PNG data URL to preserve transparency
            // Use natural dimensions for best quality (no pixelation)
            const logoNaturalWidth = logoImg.naturalWidth || logoImg.width;
            const logoNaturalHeight = logoImg.naturalHeight || logoImg.height;
            const logoCanvas = document.createElement("canvas");
            logoCanvas.width = logoNaturalWidth;
            logoCanvas.height = logoNaturalHeight;
            const logoCtx = logoCanvas.getContext("2d", { 
              alpha: true,
              willReadFrequently: false
            });
            if (logoCtx) {
              // Clear canvas completely (ensures transparent background)
              logoCtx.clearRect(0, 0, logoCanvas.width, logoCanvas.height);
              // Enable high-quality image rendering to prevent pixelation
              logoCtx.imageSmoothingEnabled = true;
              logoCtx.imageSmoothingQuality = "high";
              // Draw logo at natural size to preserve quality and transparency
              logoCtx.drawImage(logoImg, 0, 0, logoNaturalWidth, logoNaturalHeight);
              // Convert to PNG to preserve transparency (no compression artifacts)
              const logoDataUrl = logoCanvas.toDataURL("image/png");
              pdf.addImage(logoDataUrl, "PNG", logoX, yPosition, logoWidth, logoHeight, undefined, "FAST");
            } else {
              // Fallback - try direct PNG
              try {
                pdf.addImage(logoImg, "PNG", logoX, yPosition, logoWidth, logoHeight, undefined, "FAST");
              } catch (e) {
                console.warn("Could not add logo to PDF:", e);
              }
            }
            yPosition += logoHeight + spacing;
            
            // Add title
            pdf.setFontSize(14);
            pdf.setFont("helvetica", "bold");
            const titleText = "New Launch Sandbox Flowchart";
            const titleWidth = pdf.getTextWidth(titleText);
            pdf.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
            yPosition += spacing;
            
            // Add subtitle
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            const subtitleText = "Printed by Agent 1 | agent1@kwsingapore.com";
            const subtitleWidth = pdf.getTextWidth(subtitleText);
            pdf.text(subtitleText, (pageWidth - subtitleWidth) / 2, yPosition);
            yPosition += spacing;
            
            // Center flowchart horizontally
            const flowchartX = (pageWidth - flowchartWidth) / 2;
            
            // Compress flowchart image for smaller PDF size
            // Reduce resolution to 75% for smaller file size while maintaining good visual quality
            const scaleFactor = 0.75;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = Math.floor(flowchartImg.width * scaleFactor);
            tempCanvas.height = Math.floor(flowchartImg.height * scaleFactor);
            const ctx = tempCanvas.getContext("2d");
            if (ctx) {
              // Use high-quality image smoothing
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(flowchartImg, 0, 0, tempCanvas.width, tempCanvas.height);
              // Use JPEG with 0.75 quality for smaller file size
              const compressedImage = tempCanvas.toDataURL("image/jpeg", 0.75);
              // Scale dimensions proportionally
              const scaledWidth = flowchartWidth * scaleFactor;
              const scaledHeight = flowchartHeight * scaleFactor;
              const scaledX = (pageWidth - scaledWidth) / 2;
              pdf.addImage(compressedImage, "JPEG", scaledX, yPosition, scaledWidth, scaledHeight, undefined, "FAST");
            } else {
              // Fallback to PNG if canvas context fails
              pdf.addImage(exportPreview, "PNG", flowchartX, yPosition, flowchartWidth, flowchartHeight, undefined, "FAST");
            }
            
            // Save PDF
            pdf.save(`${fileName}.pdf`);
            toast.success("Flowchart exported as PDF");
            setIsExportModalOpen(false);
          } catch (error) {
            console.error("Error creating PDF:", error);
            toast.error("Failed to create PDF");
          }
        };
        flowchartImg.onerror = () => {
          toast.error("Failed to load flowchart image for PDF export");
        };
        flowchartImg.src = exportPreview;
      };
      
      logoImg.onerror = () => {
        // If logo fails to load, continue without it
        console.warn("Logo failed to load, continuing without logo");
        flowchartImg.onload = () => {
          try {
            const pageWidth = 210;
            const pageHeight = 297;
            const spacing = 4; // mm - reduced spacing between elements
            const headerPadding = 5; // mm top padding
            const titleHeight = 6; // mm for title
            const subtitleHeight = 5; // mm for subtitle
            const logoHeight = 15; // mm for logo (when logo fails, we still need space)
            const totalHeaderHeight = headerPadding + logoHeight + spacing + titleHeight + spacing + subtitleHeight + spacing;
            const availableHeight = pageHeight - totalHeaderHeight - 10;
            const availableWidth = pageWidth - 20;
            
            const flowchartAspectRatio = flowchartImg.width / flowchartImg.height;
            let flowchartWidth, flowchartHeight;
            
            if (flowchartAspectRatio > (availableWidth / availableHeight)) {
              flowchartWidth = availableWidth;
              flowchartHeight = availableWidth / flowchartAspectRatio;
            } else {
              flowchartHeight = availableHeight;
              flowchartWidth = availableHeight * flowchartAspectRatio;
            }
            
            const pdf = new jsPDF({
              orientation: "portrait",
              unit: "mm",
              format: "a4",
            });

            let yPosition = headerPadding;
            
            pdf.setFontSize(14);
            pdf.setFont("helvetica", "bold");
            const titleText = "New Launch Sandbox Flowchart";
            const titleWidth = pdf.getTextWidth(titleText);
            pdf.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
            yPosition += spacing;
            
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            const subtitleText = "Printed by Agent 1 | agent1@kwsingapore.com";
            const subtitleWidth = pdf.getTextWidth(subtitleText);
            pdf.text(subtitleText, (pageWidth - subtitleWidth) / 2, yPosition);
            yPosition += spacing;
            
            const flowchartX = (pageWidth - flowchartWidth) / 2;
            
            // Compress flowchart image for smaller PDF size
            // Reduce resolution to 75% for smaller file size
            const scaleFactor = 0.75;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = Math.floor(flowchartImg.width * scaleFactor);
            tempCanvas.height = Math.floor(flowchartImg.height * scaleFactor);
            const ctx = tempCanvas.getContext("2d");
            if (ctx) {
              // Use high-quality scaling
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(flowchartImg, 0, 0, tempCanvas.width, tempCanvas.height);
              // Use JPEG with 0.75 quality for smaller file size
              const compressedImage = tempCanvas.toDataURL("image/jpeg", 0.75);
              // Adjust dimensions for scaled image
              const scaledFlowchartWidth = flowchartWidth * scaleFactor;
              const scaledFlowchartHeight = flowchartHeight * scaleFactor;
              const scaledFlowchartX = (pageWidth - scaledFlowchartWidth) / 2;
              pdf.addImage(compressedImage, "JPEG", scaledFlowchartX, yPosition, scaledFlowchartWidth, scaledFlowchartHeight, undefined, "FAST");
            } else {
              // Fallback to PNG if canvas context fails
              pdf.addImage(exportPreview, "PNG", flowchartX, yPosition, flowchartWidth, flowchartHeight, undefined, "FAST");
            }
            
            pdf.save(`${fileName}.pdf`);
            toast.success("Flowchart exported as PDF");
            setIsExportModalOpen(false);
          } catch (error) {
            console.error("Error creating PDF:", error);
            toast.error("Failed to create PDF");
          }
        };
        flowchartImg.src = exportPreview;
      };
      
      // Load logo
      logoImg.src = "/kw-logo-pdf.webp";
      return;
    }

    // PNG export
    const link = document.createElement("a");
    link.download = `${fileName}.png`;
    link.href = exportPreview;
    link.click();

    toast.success("Flowchart exported as PNG");
    setIsExportModalOpen(false);
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
      {/* File Name Display */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium text-black/60">Currently opening canvas file name:</span>
          {isEditingName ? (
            <input
              type="text"
              value={currentFlowchartName}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleNameBlur();
                }
                if (e.key === "Escape") {
                  setIsEditingName(false);
                  // Revert to original name
                  const originalName = saveFormData.name || "Untitled Flowchart";
                  setCurrentFlowchartName(originalName);
                }
              }}
              className="flex-1 max-w-md rounded-lg border border-[#B40101] px-3 py-1.5 text-sm font-semibold text-black focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-1"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <span className="text-sm font-semibold text-black">{currentFlowchartName}</span>
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="text-black/40 hover:text-[#B40101] transition-colors"
                title="Edit file name"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          )}
        </div>
        {currentFlowchartId && (
          <span className="text-xs text-black/40 px-2 py-1 rounded bg-black/5">
            Saved
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center gap-4 border-b border-black/10 pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleNewFlowchart}
            className="rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
            title="New Flowchart"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
          <button
            onClick={handleLoadFlowcharts}
            className="rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
            title="Load Saved Flowchart"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Load
          </button>
          <button
            onClick={handleSaveClick}
            disabled={isSaving || nodes.length === 0}
            className="rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101] disabled:opacity-50 disabled:cursor-not-allowed"
            title={currentFlowchartId ? "Update Flowchart" : "Save Flowchart"}
          >
            {isSaving ? (
              <>
                <svg className="animate-spin h-4 w-4 inline mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {currentFlowchartId ? "Update" : "Save"}
              </>
            )}
          </button>
          {currentFlowchartId && (
            <button
              onClick={handleDuplicateFlowchart}
              disabled={isSaving}
              className="rounded-lg border border-[#B40101] px-4 py-2 text-sm font-semibold text-[#B40101] transition-colors hover:bg-[#B40101]/10 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Duplicate Flowchart"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Duplicate
            </button>
          )}
          <button
            type="button"
            onClick={handleExportClick}
            disabled={isExporting || nodes.length === 0}
            className="rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export Flowchart"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-4 w-4 inline mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Exporting...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export
              </>
            )}
          </button>
        </div>
        <div className="flex-1"></div>
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
        className="relative h-[800px] w-full overflow-hidden rounded-xl border border-black/10 bg-[#fafafa] cursor-move select-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, #e5e5e5 1px, transparent 1px),
            linear-gradient(to bottom, #e5e5e5 1px, transparent 1px)
          `,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          cursor: isPanning ? "grabbing" : "grab",
          userSelect: "none",
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
        onDoubleClick={(e) => {
          // Prevent default double-click behavior (text selection)
          e.preventDefault();
          
          // Only open modal if clicking directly on canvas background, not on nodes or other elements
          const target = e.target as HTMLElement;
          
          // Check if the click is on the canvas div itself or the SVG background
          if (target === canvasRef.current || target === e.currentTarget) {
            handleAddNode();
            return;
          }
          
          // Check if clicking on SVG or SVG paths (connections) - these are canvas background
          if (target.tagName === "svg" || target.tagName === "path") {
            // Make sure we're not clicking on a node by checking if target is within a node
            // Nodes have the "group" class
            const isWithinNode = target.closest('.group');
            if (!isWithinNode) {
              handleAddNode();
            }
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
              onClick={(e) => handleNodeClick(node.id, e)}
              onStartConnection={() => handleStartConnection(node.id)}
              onEdit={() => handleEditNode(node.id)}
              onDuplicate={() => handleDuplicateNode(node.id)}
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
              {/* Box / Node Name */}
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Box / Node Name <span className="text-red-500">*</span>
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
                
                {/* Percentage Section */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
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
                    {formData.usePercent && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            percentValues: [...formData.percentValues, 0],
                          });
                          setPercentInputStrings([...percentInputStrings, ""]);
                        }}
                        className="text-xs text-[#B40101] font-semibold hover:underline"
                      >
                        + Add Percentage
                      </button>
                    )}
                  </div>
                  
                  {/* Percentage Values Input - Always visible */}
                  <div className="ml-8 mt-2">
                      <div className="space-y-2">
                        {formData.percentValues.map((value, index) => {
                          // Ensure inputStrings array has enough elements
                          const inputStr = percentInputStrings[index] !== undefined 
                            ? percentInputStrings[index] 
                            : (value === 0 ? "" : String(value));
                          
                          return (
                          <div key={index} className="flex items-center gap-2">
                          <span className="text-sm text-black/60 w-8">%</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={inputStr}
                            onChange={(e) => {
                              let inputValue = e.target.value.trim();
                              
                              // Allow empty, numbers, dots, commas, and intermediate states like "0," or "0."
                              // Match: empty, numbers, numbers with one dot/comma, numbers with dot/comma and more digits
                              if (inputValue === "" || /^-?\d*[,.]?\d*$/.test(inputValue)) {
                                // Update input string array
                                const newInputStrings = [...percentInputStrings];
                                newInputStrings[index] = inputValue;
                                setPercentInputStrings(newInputStrings);
                                
                                // Replace comma with dot for parsing
                                const normalizedValue = inputValue.replace(/,/g, '.');
                                let numValue = 0;
                                
                                if (inputValue === "" || inputValue === "-" || inputValue === "," || inputValue === ".") {
                                  numValue = 0;
                                } else {
                                  const parsed = parseFloat(normalizedValue);
                                  numValue = isNaN(parsed) ? 0 : parsed;
                                }
                                
                                // Update numeric values
                                const newValues = [...formData.percentValues];
                                newValues[index] = numValue;
                                
                                // Auto-check checkbox if value is entered (including 0.5, 0,5, etc.)
                                const hasAnyValue = newValues.some(v => v !== 0);
                                
                                setFormData({
                                  ...formData,
                                  percentValues: newValues,
                                  usePercent: hasAnyValue,
                                  amountType: hasAnyValue && !formData.useFixed ? "percent" : formData.useFixed && hasAnyValue ? "percent" : formData.amountType,
                                });
                              }
                            }}
                            placeholder="e.g., 85 or 0,5 or 0.5"
                            className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                          />
                          {formData.percentValues.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newValues = formData.percentValues.filter((_, i) => i !== index);
                                const newInputStrings = percentInputStrings.filter((_, i) => i !== index);
                                const hasAnyValue = newValues.some(v => v > 0);
                                setFormData({
                                  ...formData,
                                  percentValues: newValues,
                                  usePercent: hasAnyValue,
                                });
                                setPercentInputStrings(newInputStrings);
                              }}
                              className="text-red-500 hover:text-red-700 px-2 py-1 text-sm font-semibold"
                            >
                              ×
                            </button>
                          )}
                          </div>
                        )})}
                    </div>
                    {formData.usePercent && formData.percentValues.length > 0 && (
                      <p className="mt-2 text-xs text-black/50">
                        Total: {formData.percentValues.reduce((sum, val) => sum + val, 0).toFixed(2)}%
                      </p>
                    )}
                  </div>
                </div>

                {/* Fixed Amount Section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
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
                    {formData.useFixed && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            fixedValues: [...formData.fixedValues, 0],
                          });
                          setFixedInputStrings([...fixedInputStrings, ""]);
                        }}
                        className="text-xs text-[#B40101] font-semibold hover:underline"
                      >
                        + Add Fixed Amount
                      </button>
                    )}
                  </div>
                  
                  {/* Fixed Values Input - Always visible */}
                  <div className="ml-8 mt-2">
                    <div className="space-y-2">
                      {formData.fixedValues.map((value, index) => {
                        // Ensure inputStrings array has enough elements
                        const inputStr = fixedInputStrings[index] !== undefined 
                          ? fixedInputStrings[index] 
                          : (value === 0 ? "" : String(value));
                        
                        return (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-sm text-black/60 w-8">$</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={inputStr}
                            onChange={(e) => {
                              let inputValue = e.target.value.trim();
                              
                              // Allow empty, numbers, dots, commas, and intermediate states
                              if (inputValue === "" || /^-?\d*[,.]?\d*$/.test(inputValue)) {
                                // Update input string array
                                const newInputStrings = [...fixedInputStrings];
                                newInputStrings[index] = inputValue;
                                setFixedInputStrings(newInputStrings);
                                
                                // Replace comma with dot for parsing
                                const normalizedValue = inputValue.replace(/,/g, '.');
                                let numValue = 0;
                                
                                if (inputValue === "" || inputValue === "-" || inputValue === "," || inputValue === ".") {
                                  numValue = 0;
                                } else {
                                  const parsed = parseFloat(normalizedValue);
                                  numValue = isNaN(parsed) ? 0 : parsed;
                                }
                                
                                // Update numeric values
                                const newValues = [...formData.fixedValues];
                                newValues[index] = numValue;
                                
                                // Auto-check checkbox if value is entered
                                const hasAnyValue = newValues.some(v => v !== 0);
                                
                                setFormData({
                                  ...formData,
                                  fixedValues: newValues,
                                  useFixed: hasAnyValue,
                                  amountType: hasAnyValue && !formData.usePercent ? "fixed" : formData.usePercent && hasAnyValue ? "fixed" : formData.amountType,
                                });
                              }
                            }}
                            placeholder="e.g., 3000"
                            className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                          />
                            {formData.fixedValues.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const newValues = formData.fixedValues.filter((_, i) => i !== index);
                                  const newInputStrings = fixedInputStrings.filter((_, i) => i !== index);
                                  const hasAnyValue = newValues.some(v => v > 0);
                                  setFormData({
                                    ...formData,
                                    fixedValues: newValues,
                                    useFixed: hasAnyValue,
                                  });
                                  setFixedInputStrings(newInputStrings);
                                }}
                                className="text-red-500 hover:text-red-700 px-2 py-1 text-sm font-semibold"
                              >
                                ×
                              </button>
                            )}
                        </div>
                      )})}
                    </div>
                    {formData.useFixed && formData.fixedValues.length > 0 && (
                      <p className="mt-2 text-xs text-black/50">
                        Total: {formatCurrency(formData.fixedValues.reduce((sum, val) => sum + val, 0))}
                      </p>
                    )}
                  </div>
                </div>

                {!formData.usePercent && !formData.useFixed && (
                  <p className="mt-2 text-xs text-red-500">
                    Please select at least one amount type (Percentage or Fixed)
                  </p>
                )}
              </div>

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
                      {categoryDisplayNames[cat]}
                    </button>
                  ))}
                </div>
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
                  (formData.usePercent && (formData.percentValues.length === 0 || formData.percentValues.every(v => v === 0))) ||
                  (formData.useFixed && (formData.fixedValues.length === 0 || formData.fixedValues.every(v => v === 0)))
                }
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingNodeId ? "Save Changes" : "Create Node"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Flowchart Modal */}
      {isSaveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsSaveModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-black/10">
              <h3 className="text-xl font-semibold text-black">Save Flowchart</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={saveFormData.name}
                  onChange={(e) =>
                    setSaveFormData({ ...saveFormData, name: e.target.value })
                  }
                  placeholder="Enter flowchart name"
                  className="w-full rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={saveFormData.description}
                  onChange={(e) =>
                    setSaveFormData({ ...saveFormData, description: e.target.value })
                  }
                  placeholder="Add a description"
                  rows={3}
                  className="w-full rounded-lg border border-black/20 px-4 py-2 text-base text-black focus:border-[#B40101] focus:outline-none"
                />
              </div>
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-black/10 flex gap-3">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveFlowchart}
                disabled={!saveFormData.name.trim() || isSaving}
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Flowcharts Modal */}
      {isLoadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsLoadModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] rounded-2xl border border-black/10 bg-white shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-black/10 flex-shrink-0">
              <h3 className="text-xl font-semibold text-black">Load Saved Flowchart</h3>
            </div>
            <div className="overflow-y-auto flex-1 p-6">
              {savedFlowcharts.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-black/60">No saved flowcharts found</p>
                  <p className="text-sm text-black/40 mt-2">
                    Create and save a flowchart to see it here
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedFlowcharts.map((flowchart) => (
                    <div
                      key={flowchart.id}
                      className="rounded-lg border border-black/10 p-4 hover:bg-black/5 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-black cursor-pointer" onClick={() => handleLoadFlowchart(flowchart)}>
                            {flowchart.name}
                          </h4>
                          {flowchart.description && (
                            <p className="text-sm text-black/60 mt-1">
                              {flowchart.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2 text-xs text-black/50">
                            <span>Date Created: {formatDate(flowchart.created_at)}</span>
                            <span>|</span>
                            <span>Last Modified: {formatDate(flowchart.updated_at || flowchart.created_at)}</span>
                          </div>
                          {flowchart.data?.nodes && (
                            <div className="mt-1 text-xs text-black/40">
                              {flowchart.data.nodes.length} nodes
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadFlowchart(flowchart);
                            }}
                            className="rounded-lg bg-[#B40101] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#950101]"
                          >
                            Load
                          </button>
                          {currentFlowchartId !== flowchart.id && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await duplicateFlowchart(flowchart.id);
                                  setIsLoadModalOpen(false);
                                } catch (err) {
                                  console.error("Error duplicating:", err);
                                }
                              }}
                              className="rounded-lg border border-black/20 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-black/5"
                            >
                              Duplicate
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFlowchart(flowchart.id, flowchart.name);
                            }}
                            className="rounded-lg border border-red-500 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-black/10 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsLoadModalOpen(false)}
                className="w-full rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Flowchart Confirmation Modal */}
      {isNewFlowchartModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsNewFlowchartModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-black/10">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-amber-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-black">
                    Create New Flowchart?
                  </h3>
                  <p className="mt-2 text-sm text-black/70">
                    You have unsaved changes. Creating a new flowchart will discard all current work.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 bg-amber-50 border-b border-amber-200">
              <div className="flex items-start gap-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="text-sm text-amber-800">
                  <p className="font-medium mb-1">Current changes:</p>
                  <ul className="list-disc list-inside space-y-1 text-amber-700">
                    {nodes.length > 0 && (
                      <li>{nodes.length} node{nodes.length !== 1 ? 's' : ''}</li>
                    )}
                    {connections.length > 0 && (
                      <li>{connections.length} connection{connections.length !== 1 ? 's' : ''}</li>
                    )}
                    {currentFlowchartId && (
                      <li>Unsaved modifications to current flowchart</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-black/10 flex gap-3">
              <button
                type="button"
                onClick={() => setIsNewFlowchartModalOpen(false)}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsNewFlowchartModalOpen(false);
                  // If there's a current flowchart, save it first
                  if (currentFlowchartId) {
                    try {
                      const flowchartData = {
                        nodes,
                        connections,
                        zoom,
                        pan,
                        metadata: initialData,
                      };
                      await updateFlowchart(
                        currentFlowchartId,
                        flowchartData,
                        saveFormData.name || undefined,
                        saveFormData.description || undefined
                      );
                      // After saving, create new flowchart
                      createNewFlowchart();
                    } catch (err) {
                      console.error("Error saving before creating new:", err);
                      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
                    }
                  } else {
                    // No current flowchart, just open save modal
                    setIsSaveModalOpen(true);
                  }
                }}
                className="flex-1 rounded-lg border border-amber-500 bg-white px-4 py-2 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-50"
              >
                {currentFlowchartId ? 'Save & Create New' : 'Save First'}
              </button>
              <button
                type="button"
                onClick={createNewFlowchart}
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
              >
                Create New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Preview Modal */}
      {isExportModalOpen && exportPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsExportModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-black/10 bg-white shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-black/10 flex-shrink-0">
              <h3 className="text-xl font-semibold text-black">Export Flowchart Preview</h3>
              <p className="text-sm text-black/60 mt-1">
                Review your flowchart before downloading
              </p>
            </div>
            <div className="overflow-auto flex-1 p-6 bg-white">
              <div className="bg-white rounded-lg shadow-sm p-4 inline-block border border-black/10">
                <img
                  src={exportPreview}
                  alt="Flowchart preview"
                  className="max-w-full h-auto rounded-lg"
                  style={{ maxHeight: "70vh" }}
                />
              </div>
            </div>
            <div className="p-6 border-t border-black/10 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="text-sm text-black/60">
                  <p>Export format:</p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsExportModalOpen(false)}
                    className="rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadExport("png")}
                    className="rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadExport("pdf")}
                    className="rounded-lg border border-[#B40101] bg-white px-4 py-2 text-sm font-semibold text-[#B40101] transition-colors hover:bg-[#B40101]/10"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Download PDF
                  </button>
                </div>
              </div>
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
  onClick: (e?: React.MouseEvent) => void;
  onStartConnection: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
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
  onDuplicate,
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
        onClick={(e) => onClick(e)}
        onDoubleClick={(e) => {
          // Stop propagation to prevent canvas double-click from triggering
          e.stopPropagation();
        }}
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
          <div className="mt-2 flex gap-1 justify-center opacity-0 transition-opacity group-hover:opacity-100 pointer-events-auto">
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
                onDuplicate();
              }}
              className="rounded bg-purple-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-purple-600 pointer-events-auto z-10 relative"
              style={{ fontSize: `${10 * zoom}px` }}
            >
              Duplicate
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
