"use client";

import { payoutNodes, rootNodeId, parentMap } from "@/lib/payout-schema";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import React, { useMemo } from "react";

type CommissionFlowData = {
  developerPayout: number;
  nodeValues: Record<string, { percent: number; fixed: number }>;
  nodeNames: Record<string, string>;
  projectLeadsTotal: Record<string, number>;
  dynamicChildren: Record<string, string[]>;
};

type CommissionFlowDiagramProps = {
  data: CommissionFlowData;
};

export default function CommissionFlowDiagram({ data }: CommissionFlowDiagramProps) {
  const { developerPayout, nodeValues, nodeNames, projectLeadsTotal, dynamicChildren } = data;

  // Calculate node amounts
  const nodeAmounts = useMemo(() => {
    const amounts: Record<string, number> = {
      [rootNodeId]: developerPayout,
    };

    const compute = (nodeId: string): number => {
      if (amounts[nodeId] !== undefined) return amounts[nodeId];
      
      const isDynamicChild = nodeId.startsWith("projectLeads_lead_");
      if (isDynamicChild) {
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
      
      if (nodeId === "taggerFee" && parentId === "taggerCombined") {
        const amount = Math.round((developerPayout * percent + fixed) * 100) / 100;
        amounts[nodeId] = amount;
        return amount;
      }
      
      const amount = Math.round((parentAmount * percent + fixed) * 100) / 100;
      amounts[nodeId] = amount;
      return amount;
    };

    Object.keys(payoutNodes).forEach(compute);
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
    if (dynamicChildren[nodeId]) {
      return dynamicChildren[nodeId].reduce(
        (sum, childId) => sum + (nodeAmounts[childId] ?? 0),
        0,
      );
    }
    return nodeAmounts[nodeId] ?? (nodeId === rootNodeId ? developerPayout : 0);
  };

  const getDynamicChildLabel = (childId: string): string => {
    const match = childId.match(/projectLeads_lead_(\d+)/);
    if (match) {
      const leadNumber = parseInt(match[1], 10);
      const name = nodeNames[childId];
      return name || `Leads ${leadNumber}`;
    }
    return childId;
  };

  const renderNode = (nodeId: string, level: number = 0): React.ReactElement | null => {
    const template = payoutNodes[nodeId];
    if (!template && !nodeId.startsWith("projectLeads_lead_")) return null;

    const isDynamicChild = nodeId.startsWith("projectLeads_lead_");
    const nodeTemplate = isDynamicChild
      ? {
          id: nodeId,
          label: getDynamicChildLabel(nodeId),
          description: "Individual IC lead share",
          accent: "primary" as const,
        }
      : template;

    if (!nodeTemplate) return null;

    const amount = getDisplayAmount(nodeId);
    const { percent = 0, fixed = 0 } = nodeValues[nodeId] ?? {};
    const hasChildren = Boolean(
      (nodeTemplate.childIds?.length) || (dynamicChildren[nodeId]?.length)
    );
    const children = dynamicChildren[nodeId] || nodeTemplate.childIds || [];
    const accentColor = nodeTemplate.accent === "primary" ? "#B40101" : 
                       nodeTemplate.accent === "dark" ? "#0F0F0F" : "#E5E7EB";

    return (
      <div key={nodeId} className="relative">
        {/* Node Card */}
        <div
          className="rounded-xl border-2 border-black/10 bg-white p-4 shadow-md"
          style={{ borderLeftColor: accentColor, borderLeftWidth: "4px" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-base font-semibold uppercase tracking-wide text-black/70">
                {nodeTemplate.label}
              </h3>
              {nodeTemplate.description && (
                <p className="mt-1 text-xs text-black/50">{nodeTemplate.description}</p>
              )}
              {nodeId === "projectDirector" && nodeNames[nodeId] && (
                <p className="mt-1 text-xs font-medium text-[#B40101]">
                  {nodeNames[nodeId]}
                </p>
              )}
              {isDynamicChild && nodeNames[nodeId] && (
                <p className="mt-1 text-xs font-medium text-[#B40101]">
                  {nodeNames[nodeId]}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold text-black">{formatCurrency(amount)}</p>
              {isDynamicChild ? (
                <p className="text-xs text-black/60 mt-1">Divide equally from Project Leads (IC)</p>
              ) : percent > 0 ? (
                <p className="text-xs text-black/60 mt-1">
                  {formatPercent(percent)}
                  {fixed > 0 && ` + ${formatCurrency(fixed)}`}
                </p>
              ) : fixed > 0 ? (
                <p className="text-xs text-black/60 mt-1">Fixed: {formatCurrency(fixed)}</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Children */}
        {hasChildren && children.length > 0 && (
          <div className="mt-4 ml-8 space-y-4 border-l-2 border-black/10 pl-6">
            {children.map((childId) => renderNode(childId, level + 1))}
          </div>
        )}
      </div>
    );
  };

  // Get root children
  const rootChildren = dynamicChildren[rootNodeId] || payoutNodes[rootNodeId]?.childIds || [];

  return (
    <div className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
      {/* Root Node */}
      <div className="mb-8">
        <div className="rounded-xl border-2 border-black bg-white p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold uppercase tracking-wide text-black">
                {payoutNodes[rootNodeId]?.label}
              </h2>
              {payoutNodes[rootNodeId]?.description && (
                <p className="mt-2 text-sm text-black/60">
                  {payoutNodes[rootNodeId].description}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-black">{formatCurrency(developerPayout)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Children Tree */}
      <div className="space-y-6">
        {rootChildren.map((childId) => renderNode(childId))}
      </div>

      {/* Summary Section */}
      <div className="mt-12 rounded-xl border border-black/10 bg-black/5 p-6">
        <h3 className="mb-4 text-lg font-semibold uppercase tracking-wide text-black/70">
          Summary
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm text-black/60">Total Developer Payout</p>
            <p className="text-xl font-semibold text-black">{formatCurrency(developerPayout)}</p>
          </div>
          {projectLeadsTotal["projectLeads"] && (
            <div>
              <p className="text-sm text-black/60">Total Project Leads</p>
              <p className="text-xl font-semibold text-black">
                {projectLeadsTotal["projectLeads"]} leads
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
