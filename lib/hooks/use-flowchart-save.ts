// React hook for saving flowcharts
import { useState } from "react";

export type FlowchartData = {
  nodes: any[];
  connections: any[];
  zoom?: number;
  pan?: { x: number; y: number };
  metadata?: any;
};

export function useFlowchartSave() {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveFlowchart = async (
    data: FlowchartData,
    name: string,
    description?: string,
    tags?: string[]
  ) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/flowcharts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description,
          data,
          tags,
        }),
      });

      if (!response.ok) {
        // Fallback to localStorage if API not available
        if (response.status === 501) {
          return saveToLocalStorage(data, name, description, tags);
        }
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save flowchart");
      }

      const result = await response.json();
      return result;
    } catch (err) {
      // Fallback to localStorage on network errors
      if (err instanceof TypeError && err.message.includes("fetch")) {
        return saveToLocalStorage(data, name, description, tags);
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const saveToLocalStorage = (
    data: FlowchartData,
    name: string,
    description?: string,
    tags?: string[]
  ) => {
    const id = `flowchart-${Date.now()}`;
    const flowchart = {
      id,
      user_id: "local",
      name,
      description,
      data,
      tags: tags || [],
      is_public: false,
      is_template: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    const saved = localStorage.getItem("savedFlowcharts");
    const flowcharts = saved ? JSON.parse(saved) : [];
    flowcharts.push(flowchart);
    localStorage.setItem("savedFlowcharts", JSON.stringify(flowcharts));

    return flowchart;
  };

  const updateFlowchart = async (
    id: string,
    data: FlowchartData,
    name?: string,
    description?: string
  ) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/flowcharts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description,
          data,
        }),
      });

      if (!response.ok) {
        // Fallback to localStorage if API not available
        if (response.status === 501) {
          return updateInLocalStorage(id, data, name, description);
        }
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update flowchart");
      }

      const result = await response.json();
      return result;
    } catch (err) {
      // Fallback to localStorage on network errors
      if (err instanceof TypeError && err.message.includes("fetch")) {
        return updateInLocalStorage(id, data, name, description);
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const updateInLocalStorage = (
    id: string,
    data: FlowchartData,
    name?: string,
    description?: string
  ) => {
    const saved = localStorage.getItem("savedFlowcharts");
    if (!saved) throw new Error("Flowchart not found");

    const flowcharts = JSON.parse(saved);
    const index = flowcharts.findIndex((f: any) => f.id === id);
    if (index === -1) throw new Error("Flowchart not found");

    if (name) flowcharts[index].name = name;
    if (description !== undefined) flowcharts[index].description = description;
    flowcharts[index].data = data;
    flowcharts[index].updated_at = new Date().toISOString();
    flowcharts[index].version = (flowcharts[index].version || 1) + 1;

    localStorage.setItem("savedFlowcharts", JSON.stringify(flowcharts));
    return flowcharts[index];
  };

  const duplicateFlowchart = async (id: string, newName?: string) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/flowcharts/${id}/duplicate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newName,
        }),
      });

      if (!response.ok) {
        // Fallback to localStorage if API not available
        if (response.status === 501) {
          return duplicateInLocalStorage(id, newName);
        }
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to duplicate flowchart");
      }

      const result = await response.json();
      return result;
    } catch (err) {
      // Fallback to localStorage on network errors
      if (err instanceof TypeError && err.message.includes("fetch")) {
        return duplicateInLocalStorage(id, newName);
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const duplicateInLocalStorage = (id: string, newName?: string) => {
    const saved = localStorage.getItem("savedFlowcharts");
    if (!saved) throw new Error("Flowchart not found");

    const flowcharts = JSON.parse(saved);
    const source = flowcharts.find((f: any) => f.id === id);
    if (!source) throw new Error("Flowchart not found");

    const duplicateId = `flowchart-${Date.now()}`;
    const duplicate = {
      ...source,
      id: duplicateId,
      name: newName || `${source.name} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    flowcharts.push(duplicate);
    localStorage.setItem("savedFlowcharts", JSON.stringify(flowcharts));

    return duplicate;
  };

  const deleteFlowchart = async (id: string) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/flowcharts/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // Fallback to localStorage if API not available
        if (response.status === 501) {
          return deleteFromLocalStorage(id);
        }
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete flowchart");
      }

      return { success: true };
    } catch (err) {
      // Fallback to localStorage on network errors
      if (err instanceof TypeError && err.message.includes("fetch")) {
        return deleteFromLocalStorage(id);
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const deleteFromLocalStorage = (id: string) => {
    const saved = localStorage.getItem("savedFlowcharts");
    if (!saved) throw new Error("Flowchart not found");

    const flowcharts = JSON.parse(saved);
    const filtered = flowcharts.filter((f: any) => f.id !== id);
    
    if (filtered.length === flowcharts.length) {
      throw new Error("Flowchart not found");
    }

    localStorage.setItem("savedFlowcharts", JSON.stringify(filtered));
    return { success: true };
  };

  return {
    saveFlowchart,
    updateFlowchart,
    duplicateFlowchart,
    deleteFlowchart,
    isSaving,
    error,
  };
}

