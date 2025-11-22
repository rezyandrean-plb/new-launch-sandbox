"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  useDroppable,
  type DraggableSyntheticListeners,
  type DraggableAttributes,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";

import { formatCurrency, formatPercent } from "@/lib/formatters";
import { payoutNodes, parentMap, rootNodeId } from "@/lib/payout-schema";

type NodeValueState = Record<
  string,
  {
    percent: number;
    fixed: number;
  }
>;

type ChildOrderState = Record<string, string[]>;

type NodeNamesState = Record<string, string>;

const buildInitialValues = (): NodeValueState => {
  const result: NodeValueState = {};
  Object.values(payoutNodes).forEach((node) => {
    result[node.id] = {
      percent: node.defaultPercent ?? 0,
      fixed: node.defaultFixed ?? 0,
    };
  });
  return result;
};

const buildInitialOrders = (): ChildOrderState => {
  const entries: ChildOrderState = {};
  Object.values(payoutNodes).forEach((node) => {
    if (node.childIds?.length) {
      entries[node.id] = [...node.childIds];
    }
  });
  return entries;
};

const accentPalette: Record<string, string> = {
  primary: "#B40101",
  dark: "#0F0F0F",
  neutral: "#E5E7EB",
};

const currencyHint = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format;

export function PayoutTree() {
  const router = useRouter();
  const [developerPayout, setDeveloperPayout] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInputValue, setModalInputValue] = useState("");
  const [nodeValues, setNodeValues] = useState<NodeValueState>(() =>
    buildInitialValues(),
  );
  const [childOrders, setChildOrders] = useState<ChildOrderState>(() =>
    buildInitialOrders(),
  );
  const [activeNodeId, setActiveNodeId] = useState(rootNodeId);
  const [showTreeView, setShowTreeView] = useState(false);
  const [dragInfo, setDragInfo] = useState<{
    draggedNodeId: string | null;
    overNodeId: string | null;
    draggedHasChildren?: boolean;
  } | null>(null);
  const [nodeNames, setNodeNames] = useState<NodeNamesState>({});
  const [projectLeadsTotal, setProjectLeadsTotal] = useState<Record<string, number>>({});
  const [dynamicChildren, setDynamicChildren] = useState<Record<string, string[]>>({});
  const [isProjectLeadsModalOpen, setIsProjectLeadsModalOpen] = useState(false);
  const [projectLeadsModalValue, setProjectLeadsModalValue] = useState("");
  const [pendingProjectLeadsNode, setPendingProjectLeadsNode] = useState<string | null>(null);

  const formattedTotal = useMemo(
    () => formatCurrency(developerPayout),
    [developerPayout],
  );

  // Commission flow calculation: recursively computes amounts for all nodes
  // Formula: childAmount = parentAmount * percent + fixed
  // This supports:
  // - Percentage-based commissions (percent of parent)
  // - Fixed amount commissions (flat dollar amount)
  // - Combined commissions (percentage + fixed)
  // - Group nodes sum their children (handled in getDisplayAmount)
  const nodeAmounts = useMemo(() => {
    const amounts: Record<string, number> = {
      [rootNodeId]: developerPayout,
    };

    const compute = (nodeId: string): number => {
      if (amounts[nodeId] !== undefined) return amounts[nodeId];
      
      // Check if this is a dynamic child (projectLeads child)
      const isDynamicChild = nodeId.startsWith("projectLeads_lead_");
      if (isDynamicChild) {
        const parentId = "projectLeads";
        const parentAmount = compute(parentId);
        const { fixed = 0 } = nodeValues[nodeId] ?? {};
        const amount = Math.round(fixed * 100) / 100;
        amounts[nodeId] = amount;
        return amount;
      }
      
      const parentId = parentMap[nodeId];
      if (!parentId) {
        amounts[nodeId] = 0;
        return 0;
      }
      const parentAmount = compute(parentId);
      const { percent = 0, fixed = 0 } = nodeValues[nodeId] ?? {};
      
      // Special case: taggerFee should calculate from Developer Payout, not from taggerCombined
      // because taggerCombined is a group node with 0% that aggregates its children
      if (nodeId === "taggerFee" && parentId === "taggerCombined") {
        const amount = Math.round((developerPayout * percent + fixed) * 100) / 100;
        amounts[nodeId] = amount;
        return amount;
      }
      
      // Round to 2 decimal places (cents) to avoid floating point precision issues
      const amount = Math.round((parentAmount * percent + fixed) * 100) / 100;
      amounts[nodeId] = amount;
      return amount;
    };

    Object.keys(payoutNodes).forEach(compute);
    // Also compute dynamic children
    Object.keys(dynamicChildren).forEach((parentId) => {
      dynamicChildren[parentId].forEach((childId) => {
        compute(childId);
      });
    });
    return amounts;
  }, [developerPayout, nodeValues, dynamicChildren]);

  const getDisplayAmount = (nodeId: string) => {
    const template = payoutNodes[nodeId];
    if (template?.kind === "group") {
      return (template.childIds ?? []).reduce(
        (sum, childId) => sum + (nodeAmounts[childId] ?? 0),
        0,
      );
    }
    return nodeAmounts[nodeId] ?? (nodeId === rootNodeId ? developerPayout : 0);
  };

  const activeAmount = getDisplayAmount(activeNodeId);

  const activeChildren = useMemo(() => {
    // Check if this node has dynamic children (projectLeads)
    if (dynamicChildren[activeNodeId]) {
      return dynamicChildren[activeNodeId];
    }
    return childOrders[activeNodeId] ??
      payoutNodes[activeNodeId]?.childIds ??
      ([] as string[]);
  }, [activeNodeId, childOrders, dynamicChildren]);

  const breadcrumbPath = useMemo(() => {
    const chain: string[] = [];
    let cursor: string | null | undefined = activeNodeId;
    while (cursor) {
      chain.unshift(cursor);
      cursor = parentMap[cursor] ?? null;
    }
    return chain;
  }, [activeNodeId]);

  const handleValueChange = (
    nodeId: string,
    field: "percent" | "fixed",
    value: number,
  ) => {
    setNodeValues((prev) => ({
      ...prev,
      [nodeId]: {
        ...prev[nodeId],
        [field]: Number.isFinite(value) ? value : 0,
      },
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const draggedNodeId = event.active.id as string;
    const draggedNode = payoutNodes[draggedNodeId];
    const hasChildren = Boolean(
      draggedNode?.childIds?.length || dynamicChildren[draggedNodeId]?.length
    );
    setDragInfo({
      draggedNodeId,
      overNodeId: null,
      draggedHasChildren: hasChildren,
    });
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      setDragInfo((prev) => prev ? { ...prev, overNodeId: null } : null);
      return;
    }

    const draggedNodeId = active.id as string;
    const overNodeId = over.id as string;
    const draggedParentId = active.data.current?.parentId as string | undefined;
    const overParentId = over.data.current?.parentId as string | undefined;

    // Check if dragging over parent card
    if (overNodeId === activeNodeId && draggedParentId === activeNodeId) {
      setDragInfo((prev) => ({
        draggedNodeId,
        overNodeId,
        draggedHasChildren: prev?.draggedHasChildren,
      }));
    } else if (
      draggedParentId === overParentId &&
      draggedParentId === activeNodeId &&
      draggedNodeId !== overNodeId
    ) {
      // Dragging over another child for reordering
      setDragInfo((prev) => ({
        draggedNodeId,
        overNodeId,
        draggedHasChildren: prev?.draggedHasChildren,
      }));
    } else {
      setDragInfo((prev) => ({
        draggedNodeId,
        overNodeId: null,
        draggedHasChildren: prev?.draggedHasChildren,
      }));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    // Clear drag info
    setDragInfo(null);
    
    if (!over) return;
    
    const draggedNodeId = active.id as string;
    const overNodeId = over.id as string;
    const draggedParentId = active.data.current?.parentId as string | undefined;
    
    // Check if dropped on parent card (Developer Payout or any parent)
    if (overNodeId === activeNodeId && draggedParentId === activeNodeId) {
      // Dropped on parent card - navigate to the dragged card's branch
      const draggedNode = payoutNodes[draggedNodeId];
      
      // Special handling for projectLeads
      if (draggedNodeId === "projectLeads") {
        const existingTotal = projectLeadsTotal[draggedNodeId];
        if (!existingTotal || existingTotal === 0) {
          setPendingProjectLeadsNode(draggedNodeId);
          setProjectLeadsModalValue("");
          setIsProjectLeadsModalOpen(true);
          return;
        }
      }
      
      if (draggedNode?.childIds?.length || dynamicChildren[draggedNodeId]) {
        setActiveNodeId(draggedNodeId);
        setShowTreeView(false);
      }
      return;
    }
    
    // Normal reordering within the same parent
    const overParentId = over.data.current?.parentId as string | undefined;
    if (!draggedParentId || draggedParentId !== overParentId || draggedParentId !== activeNodeId)
      return;
    const currentOrder = childOrders[draggedParentId];
    if (!currentOrder) return;
    const oldIndex = currentOrder.indexOf(draggedNodeId);
    const newIndex = currentOrder.indexOf(overNodeId);
    if (oldIndex === -1 || newIndex === -1) return;
    setChildOrders((prev) => ({
      ...prev,
      [draggedParentId]: arrayMove(currentOrder, oldIndex, newIndex),
    }));
  };

  const handleInspectNode = (nodeId: string) => {
    // Check if it's projectLeads and needs dynamic children setup
    if (nodeId === "projectLeads") {
      const existingTotal = projectLeadsTotal[nodeId];
      if (!existingTotal || existingTotal === 0) {
        // Show dialog to set total leads
        setPendingProjectLeadsNode(nodeId);
        setProjectLeadsModalValue("");
        setIsProjectLeadsModalOpen(true);
        return;
      }
    }
    if (payoutNodes[nodeId]?.childIds?.length || dynamicChildren[nodeId]) {
      setActiveNodeId(nodeId);
      setShowTreeView(false);
    }
  };

  const handleOpenProjectLeadsModal = (nodeId: string) => {
    const existingTotal = projectLeadsTotal[nodeId];
    setPendingProjectLeadsNode(nodeId);
    setProjectLeadsModalValue(existingTotal ? String(existingTotal) : "");
    setIsProjectLeadsModalOpen(true);
  };

  const handleCloseProjectLeadsModal = () => {
    setIsProjectLeadsModalOpen(false);
    setProjectLeadsModalValue("");
    setPendingProjectLeadsNode(null);
  };

  const handleSubmitProjectLeadsModal = () => {
    const total = Number(projectLeadsModalValue) || 0;
    if (total > 0 && pendingProjectLeadsNode) {
      setProjectLeadsTotal((prev) => ({
        ...prev,
        [pendingProjectLeadsNode]: total,
      }));
      
      // Create dynamic child nodes
      const childIds: string[] = [];
      for (let i = 1; i <= total; i++) {
        const childId = `${pendingProjectLeadsNode}_lead_${i}`;
        childIds.push(childId);
      }
      
      setDynamicChildren((prev) => ({
        ...prev,
        [pendingProjectLeadsNode]: childIds,
      }));
      
      // Initialize values for dynamic children (equal share)
      // Calculate parent amount: get the parent of projectLeads and calculate its amount
      const parentId = parentMap[pendingProjectLeadsNode];
      let parentAmount = developerPayout;
      if (parentId) {
        const parentParentId = parentMap[parentId];
        const grandParentAmount = parentParentId ? nodeAmounts[parentParentId] ?? developerPayout : developerPayout;
        const parentPercent = nodeValues[parentId]?.percent ?? 0;
        const parentFixed = nodeValues[parentId]?.fixed ?? 0;
        parentAmount = grandParentAmount * parentPercent + parentFixed;
      }
      const projectLeadsPercent = nodeValues[pendingProjectLeadsNode]?.percent ?? 0.5;
      const projectLeadsAmount = parentAmount * projectLeadsPercent;
      const sharePerLead = projectLeadsAmount / total;
      
      setNodeValues((prev) => {
        const updated = { ...prev };
        childIds.forEach((childId) => {
          updated[childId] = {
            percent: 0,
            fixed: Math.round((sharePerLead) * 100) / 100,
          };
        });
        return updated;
      });
      
      setIsProjectLeadsModalOpen(false);
      setProjectLeadsModalValue("");
      setPendingProjectLeadsNode(null);
      
      // Navigate to the node
      setActiveNodeId(pendingProjectLeadsNode);
      setShowTreeView(false);
    }
  };

  const handleBreadcrumbClick = (nodeId: string) => {
    setActiveNodeId(nodeId);
    setShowTreeView(false);
  };

  const handleOpenModal = () => {
    setModalInputValue(developerPayout > 0 ? String(developerPayout) : "");
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalInputValue("");
  };

  const handleSubmitModal = () => {
    const value = Number(modalInputValue) || 0;
    if (value > 0) {
      setDeveloperPayout(value);
      setIsModalOpen(false);
      setModalInputValue("");
    }
  };

  const parentIdForActive = parentMap[activeNodeId];

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-black/70">
              Developer payout
            </p>
            <h2 className="text-3xl font-semibold text-black">
              {formattedTotal}
            </h2>
            <p className="text-sm text-black/60">
              {developerPayout > 0
                ? "Click the button to update the payout amount."
                : "Click the button below to enter the developer payout amount."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenModal}
            className="rounded-lg bg-[#B40101] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#950101] focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-2"
          >
            {developerPayout > 0 ? "Update Payout" : "Enter Payout Amount"}
          </button>
        </div>
      </div>
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={handleCloseModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-black">
              Enter Developer Payout Amount
            </h3>
            <p className="mt-2 text-sm text-black/70">
              Enter the total commission payout from the developer in USD.
            </p>
            <div className="mt-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-black">
                Payout Amount (USD)
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={modalInputValue}
                  onChange={(event) => setModalInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSubmitModal();
                    } else if (event.key === "Escape") {
                      handleCloseModal();
                    }
                  }}
                  autoFocus
                  className="rounded-lg border border-black/20 px-4 py-2 text-base font-semibold text-black focus:border-[#B40101] focus:outline-none"
                  placeholder="e.g., 1000000"
                />
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitModal}
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {developerPayout > 0 && (
        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        {/* Stacked Parent Cards */}
        {breadcrumbPath.length > 1 && (
          <div className="mb-6 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 mb-3">
              Parent Hierarchy
            </p>
            {breadcrumbPath.slice(0, -1).map((nodeId, index) => {
              const node = payoutNodes[nodeId];
              const amount = getDisplayAmount(nodeId);
              return (
                <div key={nodeId} className="relative">
                  {index > 0 && (
                    <div className="absolute -top-3 left-6 flex flex-col items-center">
                      <div className="h-3 w-px bg-black/20" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleBreadcrumbClick(nodeId)}
                    className="w-full text-left rounded-xl border border-black/10 bg-white p-4 shadow-sm hover:shadow-md transition-shadow hover:border-[#B40101]/30"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-wide text-black/70">
                          {node?.label ?? nodeId}
                        </p>
                        {node?.description && (
                          <p className="text-xs text-black/50 mt-0.5">{node.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-black">
                          {formatCurrency(amount)}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {/* Breadcrumbs */}
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-black/60">
          {breadcrumbPath.map((nodeId, index) => {
            const isLast = index === breadcrumbPath.length - 1;
            const node = payoutNodes[nodeId];
            const hasChildren = Boolean(node?.childIds?.length);
            return (
              <span key={nodeId} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(nodeId)}
                  className={clsx(
                    "rounded-full px-3 py-1",
                    isLast
                      ? "bg-black text-white"
                      : "bg-black/5 text-black hover:bg-black/10",
                  )}
                >
                  {node?.label ?? nodeId}
                </button>
                {isLast && hasChildren && (
                  <button
                    type="button"
                    onClick={() => setShowTreeView(!showTreeView)}
                    className="ml-1 rounded-full bg-[#B40101] px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#950101]"
                    title={`Show tree for ${node?.label}`}
                  >
                    {showTreeView ? "Hide Tree" : "Show Tree"}
                  </button>
                )}
                {!isLast ? <span>→</span> : null}
              </span>
            );
          })}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-black/60">
              Viewing branch
            </p>
            <h3 className="text-lg font-semibold text-black">
              {payoutNodes[activeNodeId]?.label}
            </h3>
          </div>
          {parentIdForActive ? (
            <button
              type="button"
              onClick={() => {
                setActiveNodeId(parentIdForActive);
                setShowTreeView(false);
              }}
              className="text-sm font-semibold text-[#B40101] hover:underline"
            >
              ← Back to {payoutNodes[parentIdForActive]?.label}
            </button>
          ) : null}
        </div>
        {showTreeView && (
          <div className="mt-6 rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wide text-black/70">
              Tree Path to Current Branch
            </h4>
            <TreeView
              path={breadcrumbPath}
              nodeAmounts={nodeAmounts}
              nodeValues={nodeValues}
            />
          </div>
        )}
        {dragInfo && dragInfo.overNodeId && dragInfo.draggedNodeId && (
          <div className="mt-4 rounded-lg bg-[#B40101] px-4 py-3 text-sm font-semibold text-white shadow-lg">
            {dragInfo.overNodeId === activeNodeId ? (
              <span>
                Drop <strong>{payoutNodes[dragInfo.draggedNodeId]?.label}</strong> into{" "}
                <strong>{payoutNodes[dragInfo.overNodeId]?.label}</strong> to open branch
              </span>
            ) : (
              <span>
                Drop <strong>{payoutNodes[dragInfo.draggedNodeId]?.label}</strong> before{" "}
                <strong>{payoutNodes[dragInfo.overNodeId]?.label}</strong> to reorder
              </span>
            )}
          </div>
        )}
        <DndContext
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="mt-6">
            <DroppableParentCard
              nodeId={activeNodeId}
              amount={activeAmount}
              values={nodeValues}
              onValueChange={handleValueChange}
              dragInfo={dragInfo}
            />
          </div>
          {activeChildren.length ? (
            <SortableContext items={activeChildren} strategy={rectSortingStrategy}>
              <div className={`mt-6 grid gap-4 ${
                activeNodeId === rootNodeId 
                  ? 'md:grid-cols-3' 
                  : activeChildren.length > 2 
                    ? activeChildren.length === 3
                      ? 'md:grid-cols-3'
                      : activeChildren.length === 4
                        ? 'md:grid-cols-4'
                        : activeChildren.length === 5
                          ? 'md:grid-cols-5'
                          : 'md:grid-cols-6'
                    : 'md:grid-cols-2'
              }`}>
                {activeChildren.map((childId) => (
                  <SortableNode
                    key={childId}
                    nodeId={childId}
                    parentId={activeNodeId}
                    amount={getDisplayAmount(childId)}
                    nodeValues={nodeValues}
                    onValueChange={handleValueChange}
                    onOpenBranch={handleInspectNode}
                    hasMultipleChildren={activeChildren.length > 2}
                    nodeNames={nodeNames}
                    onNodeNameChange={(nodeId, name) => {
                      setNodeNames((prev) => ({
                        ...prev,
                        [nodeId]: name,
                      }));
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          ) : (
            <p className="mt-6 rounded-2xl bg-black/5 px-4 py-3 text-sm text-black/70">
              No further branches under this node. Adjust the values above or go
              back using the breadcrumb trail.
            </p>
          )}
        </DndContext>
        </div>
      )}
      {/* Save Commission Flow Button - Only show when viewing Project Leads */}
      {activeNodeId === "projectLeads" && (
        <button
          type="button"
          onClick={() => {
            const commissionFlowData = {
              developerPayout,
              nodeValues,
              nodeNames,
              projectLeadsTotal,
              dynamicChildren,
            };
            
            // Store in localStorage as backup
            localStorage.setItem("commissionFlowData", JSON.stringify(commissionFlowData));
            
            // Encode data and navigate to diagram page
            const encodedData = btoa(encodeURIComponent(JSON.stringify(commissionFlowData)));
            router.push(`/diagram?data=${encodedData}`);
          }}
          className="fixed bottom-6 right-6 flex items-center gap-2 rounded-lg bg-[#B40101] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#950101] focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-2 z-40"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          Save Commission Flow
        </button>
      )}
      {isProjectLeadsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={handleCloseProjectLeadsModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-black">
              Set Total Project Leads
            </h3>
            <p className="mt-2 text-sm text-black/70">
              Enter the total number of project leads. The Project Leads (IC) 50% amount will be divided equally among all leads.
            </p>
            <div className="mt-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-black">
                Total Project Leads
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={projectLeadsModalValue}
                  onChange={(event) => setProjectLeadsModalValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSubmitProjectLeadsModal();
                    } else if (event.key === "Escape") {
                      handleCloseProjectLeadsModal();
                    }
                  }}
                  autoFocus
                  className="rounded-lg border border-black/20 px-4 py-2 text-base font-semibold text-black focus:border-[#B40101] focus:outline-none"
                  placeholder="e.g., 4"
                />
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleCloseProjectLeadsModal}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitProjectLeadsModal}
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type TreeViewProps = {
  path: string[];
  nodeAmounts: Record<string, number>;
  nodeValues: NodeValueState;
};

const TreeView = ({ path, nodeAmounts, nodeValues }: TreeViewProps) => {
  const accentPalette: Record<string, string> = {
    primary: "#B40101",
    dark: "#0F0F0F",
    neutral: "#E5E7EB",
  };

  return (
    <div className="space-y-3">
      {path.map((nodeId, index) => {
        const node = payoutNodes[nodeId];
        const amount = nodeAmounts[nodeId] ?? 0;
        const { percent, fixed } = nodeValues[nodeId] ?? { percent: 0, fixed: 0 };
        const accentColor = accentPalette[node?.accent ?? "neutral"];
        const isLast = index === path.length - 1;
        const isFirst = index === 0;

        return (
          <div key={nodeId} className="relative">
            {index > 0 && (
              <div className="absolute -top-3 left-6 flex flex-col items-center">
                <div className="h-3 w-px bg-black/20" />
                <div className="h-px w-3 bg-black/20" />
              </div>
            )}
            <div
              className="rounded-lg border border-black/10 bg-white p-3 shadow-sm"
              style={{
                borderLeftWidth: isFirst ? "1px" : "3px",
                borderLeftColor: isFirst ? undefined : accentColor,
                marginLeft: index > 0 ? "1.5rem" : "0",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/70">
                    {node?.label}
                  </p>
                  {node?.description && (
                    <p className="mt-1 text-xs text-black/50">{node.description}</p>
                  )}
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-lg font-semibold text-black">
                      {formatCurrency(amount)}
                    </span>
                    {nodeId !== rootNodeId && (
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-black/70">
                        {percent > 0 ? `${formatPercent(percent)}` : "Fixed"}
                        {fixed ? ` + ${currencyHint(fixed)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {isLast && (
                  <span className="rounded-full bg-[#B40101] px-2 py-1 text-xs font-semibold text-white">
                    Current
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

type DroppableParentCardProps = {
  nodeId: string;
  amount: number;
  values: NodeValueState;
  onValueChange: (
    nodeId: string,
    field: "percent" | "fixed",
    value: number,
  ) => void;
  dragInfo?: {
    draggedNodeId: string | null;
    overNodeId: string | null;
    draggedHasChildren?: boolean;
  } | null;
};

const DroppableParentCard = ({
  nodeId,
  amount,
  values,
  onValueChange,
  dragInfo,
}: DroppableParentCardProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: nodeId,
    data: { parentId: nodeId },
  });

  // Show message when dragging a branch (has children) and not dragging the parent itself
  const showExpandMessage = dragInfo?.draggedHasChildren && 
                           dragInfo.draggedNodeId !== null && 
                           dragInfo.draggedNodeId !== nodeId;

  return (
    <div
      ref={setNodeRef}
      className={clsx("transition-all relative", {
        "ring-2 ring-[#B40101] ring-offset-2 rounded-2xl animate-pulse": isOver && dragInfo?.draggedHasChildren,
        "ring-2 ring-[#B40101] ring-offset-2 rounded-2xl": isOver && !dragInfo?.draggedHasChildren,
      })}
    >
      <TreeNode
        nodeId={nodeId}
        amount={amount}
        values={values}
        onValueChange={onValueChange}
      />
      {showExpandMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#B40101]/10 rounded-2xl pointer-events-none z-10 animate-fade-in">
          <div className="bg-[#B40101] text-white px-6 py-3 rounded-lg shadow-lg animate-bounce">
            <p className="text-sm font-semibold">Drag here to expand</p>
          </div>
        </div>
      )}
    </div>
  );
};

type SortableNodeProps = {
  nodeId: string;
  parentId: string;
  amount: number;
  nodeValues: NodeValueState;
  onValueChange: (
    nodeId: string,
    field: "percent" | "fixed",
    value: number,
  ) => void;
  onOpenBranch: (nodeId: string) => void;
  hasMultipleChildren?: boolean;
  nodeNames: NodeNamesState;
  onNodeNameChange: (nodeId: string, name: string) => void;
  onOpenProjectLeadsModal?: (nodeId: string) => void;
  projectLeadsTotal?: Record<string, number>;
  dynamicChildren?: Record<string, string[]>;
};

const SortableNode = ({
  nodeId,
  parentId,
  nodeValues,
  onValueChange,
  amount,
  onOpenBranch,
  hasMultipleChildren = false,
  nodeNames,
  onNodeNameChange,
  onOpenProjectLeadsModal,
  projectLeadsTotal,
  dynamicChildren = {},
}: SortableNodeProps) => {
  // Disable drag for dynamic Leads children
  const isDynamicChild = nodeId.startsWith("projectLeads_lead_");
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: nodeId,
    data: { parentId },
    disabled: isDynamicChild,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={clsx({ "z-10": isDragging })}>
      <TreeNode
        nodeId={nodeId}
        amount={amount}
        values={nodeValues}
        onValueChange={onValueChange}
        dragAttributes={isDynamicChild ? undefined : attributes}
        dragListeners={isDynamicChild ? undefined : listeners}
        onOpenBranch={onOpenBranch}
        hasMultipleChildren={hasMultipleChildren}
        nodeNames={nodeNames}
        onNodeNameChange={onNodeNameChange}
        onOpenProjectLeadsModal={onOpenProjectLeadsModal}
        projectLeadsTotal={projectLeadsTotal}
        dynamicChildren={dynamicChildren}
      />
    </div>
  );
};

type TreeNodeProps = {
  nodeId: string;
  amount: number;
  values: NodeValueState;
  onValueChange: (
    nodeId: string,
    field: "percent" | "fixed",
    value: number,
  ) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  onOpenBranch?: (nodeId: string) => void;
  hasMultipleChildren?: boolean;
  nodeNames?: NodeNamesState;
  onNodeNameChange?: (nodeId: string, name: string) => void;
  onOpenProjectLeadsModal?: (nodeId: string) => void;
  projectLeadsTotal?: Record<string, number>;
  dynamicChildren?: Record<string, string[]>;
};

// Helper function to get label for dynamic project leads children
const getDynamicChildLabel = (childId: string): string => {
  const match = childId.match(/projectLeads_lead_(\d+)/);
  if (match) {
    const leadNumber = parseInt(match[1], 10);
    return `Leads ${leadNumber}`;
  }
  return childId;
};

const TreeNode = ({
  nodeId,
  amount,
  values,
  onValueChange,
  dragAttributes,
  dragListeners,
  onOpenBranch,
  hasMultipleChildren = false,
  nodeNames = {},
  onNodeNameChange,
  onOpenProjectLeadsModal,
  projectLeadsTotal = {},
  dynamicChildren = {},
}: TreeNodeProps) => {
  const [showFixedInput, setShowFixedInput] = useState(false);
  const [isIncentiveModalOpen, setIsIncentiveModalOpen] = useState(false);
  const [incentiveModalValue, setIncentiveModalValue] = useState("");
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [nameModalValue, setNameModalValue] = useState("");
  
  // Check if this is a dynamic child (projectLeads child)
  const isDynamicChildNode = nodeId.startsWith("projectLeads_lead_");
  const template = isDynamicChildNode 
    ? {
        id: nodeId,
        label: getDynamicChildLabel(nodeId),
        description: "Individual IC lead share",
        defaultPercent: 0,
        accent: "primary" as const,
      }
    : payoutNodes[nodeId];
  
  // Handle case where template doesn't exist
  if (!template) {
    console.warn(`Template not found for nodeId: ${nodeId}`);
    return null;
  }
  
  const { percent, fixed } = values[nodeId] ?? { percent: 0, fixed: 0 };
  const accentColor = accentPalette[template.accent ?? "neutral"];
  const hasStaticChildren = Boolean(template.childIds?.length);
  // Check if this node has dynamic children (for projectLeads)
  const hasDynamicChildren = dynamicChildren[nodeId] && dynamicChildren[nodeId].length > 0;
  const hasChildren = hasStaticChildren || hasDynamicChildren;
  const isGroup = template.kind === "group";
  const isTaggerIncentive = nodeId === "taggerIncentive";
  const isTaggerCombined = nodeId === "taggerCombined";
  const isTaggerFee = nodeId === "taggerFee";
  const isTaggerKw = nodeId === "taggerKw";
  const isTaggerEra = nodeId === "taggerEra";
  const isProjectDirector = nodeId === "projectDirector";
  const isProjectLeads = nodeId === "projectLeads";
  const projectDirectorName = nodeNames[nodeId] || "";
  const leadName = isDynamicChildNode ? (nodeNames[nodeId] || "") : "";
  const childLabels =
    isGroup && template.childIds
      ? template.childIds.map((childId) => payoutNodes[childId]?.label ?? childId)
      : [];
  
  const hasPercent = (percent ?? 0) > 0;
  const parentId = parentMap[nodeId];
  const parentLabel = parentId ? payoutNodes[parentId]?.label ?? parentId : "parent";
  
  // Get taggerIncentive fixed value for the "Add Incentive Amount" button
  const taggerIncentiveFixed = isTaggerCombined ? (values["taggerIncentive"]?.fixed ?? 0) : 0;

  useEffect(() => {
    if (!hasPercent) {
      setShowFixedInput(false);
    }
  }, [hasPercent]);

  const handleOpenIncentiveModal = () => {
    const incentiveValue = isTaggerCombined ? taggerIncentiveFixed : fixed;
    setIncentiveModalValue(incentiveValue > 0 ? String(incentiveValue) : "");
    setIsIncentiveModalOpen(true);
  };

  const handleCloseIncentiveModal = () => {
    setIsIncentiveModalOpen(false);
    setIncentiveModalValue("");
  };

  const handleSubmitIncentiveModal = () => {
    const value = Number(incentiveModalValue) || 0;
    if (value >= 0) {
      // If it's taggerCombined, update taggerIncentive node instead
      const targetNodeId = isTaggerCombined ? "taggerIncentive" : nodeId;
      onValueChange(targetNodeId, "fixed", value);
      setIsIncentiveModalOpen(false);
      setIncentiveModalValue("");
    }
  };

  const handleOpenNameModal = () => {
    const currentName = isDynamicChildNode ? leadName : projectDirectorName;
    setNameModalValue(currentName);
    setIsNameModalOpen(true);
  };

  const handleCloseNameModal = () => {
    setIsNameModalOpen(false);
    setNameModalValue("");
  };

  const handleSubmitNameModal = () => {
    if (onNodeNameChange) {
      onNodeNameChange(nodeId, nameModalValue.trim());
      setIsNameModalOpen(false);
      setNameModalValue("");
    }
  };

  // Get display label with name if available
  const displayLabel = isProjectDirector && projectDirectorName
    ? `${template.label} - ${projectDirectorName}`
    : template.label;
  
  // For dynamic Leads, use the name if provided, otherwise use the template label
  const finalLabel = isDynamicChildNode && leadName
    ? leadName
    : displayLabel;

  return (
    <article className={`w-full rounded-2xl border border-black/10 bg-white shadow-[0px_4px_24px_rgba(0,0,0,0.05)] ${hasMultipleChildren ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className={`font-semibold uppercase tracking-wide text-black/70 ${hasMultipleChildren ? 'text-xs' : 'text-sm'}`}>
            {finalLabel}
          </p>
          {template.description ? (
            <p className={`text-black/50 ${hasMultipleChildren ? 'text-[10px] mt-0.5' : 'text-xs mt-1'}`}>{template.description}</p>
          ) : null}
        </div>
        {isProjectDirector && (
          <button
            type="button"
            onClick={handleOpenNameModal}
            className={`rounded-lg bg-[#B40101] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#950101] focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-2 ${hasMultipleChildren ? 'px-2 py-1 text-[10px]' : ''}`}
          >
            {projectDirectorName ? "Edit Name" : "Add Name"}
          </button>
        )}
        {isProjectLeads && onOpenProjectLeadsModal && (
          <button
            type="button"
            onClick={() => onOpenProjectLeadsModal(nodeId)}
            className={`rounded-lg bg-[#B40101] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#950101] focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-2 ${hasMultipleChildren ? 'px-2 py-1 text-[10px]' : ''}`}
          >
            {projectLeadsTotal?.[nodeId] ? `Edit Leads (${projectLeadsTotal[nodeId]})` : "Set Total Leads"}
          </button>
        )}
        {isDynamicChildNode && (
          <button
            type="button"
            onClick={handleOpenNameModal}
            className={`rounded-lg bg-[#B40101] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#950101] focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-2 ${hasMultipleChildren ? 'px-2 py-1 text-[10px]' : ''}`}
          >
            {leadName ? "Edit Name" : "Add Name"}
          </button>
        )}
        {dragAttributes && dragListeners && !isDynamicChildNode ? (
          <button
            type="button"
            className={`inline-flex items-center rounded-full border border-black/10 px-3 text-xs font-semibold uppercase tracking-wide transition-colors ${hasMultipleChildren ? 'h-7 px-2 text-[10px]' : 'h-8'} ${
              hasChildren
                ? 'text-white hover:bg-[#950101] cursor-grab active:cursor-grabbing'
                : 'text-black/50 bg-black/5 cursor-not-allowed opacity-50'
            }`}
            style={hasChildren ? { backgroundColor: "#B40101" } : {}}
            {...(hasChildren ? dragAttributes : {})}
            {...(hasChildren ? dragListeners : {})}
            disabled={!hasChildren}
          >
            Drag
          </button>
        ) : null}
      </div>
      <div className={`mt-3 flex flex-wrap items-baseline gap-3 ${hasMultipleChildren ? 'gap-2' : ''}`}>
        <span className={`font-semibold text-black ${hasMultipleChildren ? 'text-lg' : 'text-2xl'}`}>
          {formatCurrency(amount)}
        </span>
        {isTaggerCombined && (
          <button
            type="button"
            onClick={handleOpenIncentiveModal}
            className="rounded-lg bg-[#B40101] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#950101] focus:outline-none focus:ring-2 focus:ring-[#B40101] focus:ring-offset-2"
          >
            {taggerIncentiveFixed > 0 ? `Edit Incentive (${currencyHint(taggerIncentiveFixed)})` : "Add Incentive Amount"}
          </button>
        )}
        {nodeId !== rootNodeId && !isGroup && !isTaggerCombined && !isTaggerIncentive ? (
          <span className={`rounded-full bg-black/5 px-3 py-1 font-semibold text-black/70 ${hasMultipleChildren ? 'text-[10px] px-2 py-0.5' : 'text-xs'}`}>
            {isDynamicChildNode 
              ? "Divide equally from Project Leads (IC)"
              : percent > 0 
                ? `${formatPercent(percent)} of ${parentLabel}` 
                : "Fixed only"
            }
            {!isDynamicChildNode && fixed ? ` + ${currencyHint(fixed)}` : ""}
          </span>
        ) : null}
      </div>
      {nodeId !== rootNodeId && !isGroup && !isTaggerCombined && !isTaggerIncentive && !isTaggerKw && !isTaggerEra && !isDynamicChildNode ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {!hasPercent && (
            <>
              {!showFixedInput ? (
                <div className="flex flex-col gap-1 w-full">
                  <span className="text-xs font-medium uppercase tracking-wide text-black/70">
                    Fixed adjustment (USD)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFixedInput(true)}
                    className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
                  >
                    Enter Amount
                  </button>
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-black/70 w-full">
                  Fixed adjustment (USD)
                  <input
                    type="number"
                    step={100}
                    value={fixed ?? 0}
                    onChange={(event) =>
                      onValueChange(nodeId, "fixed", Number(event.target.value) || 0)
                    }
                    onBlur={() => {
                      if ((fixed ?? 0) === 0) {
                        setShowFixedInput(false);
                      }
                    }}
                    className="rounded-lg border border-black/20 px-3 py-2 text-sm font-semibold text-black focus:border-[#B40101] focus:outline-none"
                  />
                </label>
              )}
            </>
          )}
        </div>
      ) : null}
      {isGroup && childLabels.length ? (
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-black/50">
          Aggregates: {childLabels.join(" + ")}
        </p>
      ) : null}
      {hasChildren && onOpenBranch ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#B40101] hover:underline"
            onClick={() => onOpenBranch(nodeId)}
          >
            View branch →
          </button>
        </div>
      ) : null}
      {(isIncentiveModalOpen && (isTaggerCombined || isTaggerIncentive)) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={handleCloseIncentiveModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-black">
              {isTaggerCombined ? "Add Incentive Amount" : "Edit Tagger Incentive"}
            </h3>
            <p className="mt-2 text-sm text-black/70">
              Enter the incentive amount in USD. This will affect all branches under this incentive.
            </p>
            <div className="mt-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-black">
                Incentive Amount (USD)
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={incentiveModalValue}
                  onChange={(event) => setIncentiveModalValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSubmitIncentiveModal();
                    } else if (event.key === "Escape") {
                      handleCloseIncentiveModal();
                    }
                  }}
                  autoFocus
                  className="rounded-lg border border-black/20 px-4 py-2 text-base font-semibold text-black focus:border-[#B40101] focus:outline-none"
                  placeholder="e.g., 2000"
                />
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleCloseIncentiveModal}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitIncentiveModal}
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {isNameModalOpen && (isProjectDirector || isDynamicChildNode) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={handleCloseNameModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-black">
              {isDynamicChildNode 
                ? (leadName ? "Edit Lead Name" : "Add Lead Name")
                : (projectDirectorName ? "Edit Project Director Name" : "Add Project Director Name")
              }
            </h3>
            <p className="mt-2 text-sm text-black/70">
              {isDynamicChildNode 
                ? "Enter the name of this lead."
                : "Enter the name of the Project Director."
              }
            </p>
            <div className="mt-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-black">
                {isDynamicChildNode ? "Lead Name" : "Project Director Name"}
                <input
                  type="text"
                  value={nameModalValue}
                  onChange={(event) => setNameModalValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSubmitNameModal();
                    } else if (event.key === "Escape") {
                      handleCloseNameModal();
                    }
                  }}
                  autoFocus
                  className="rounded-lg border border-black/20 px-4 py-2 text-base font-semibold text-black focus:border-[#B40101] focus:outline-none"
                  placeholder="e.g., John Doe"
                />
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleCloseNameModal}
                className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitNameModal}
                className="flex-1 rounded-lg bg-[#B40101] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#950101]"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
};

