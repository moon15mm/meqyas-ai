"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { projectApi } from "@/lib/api/endpoints";

export function useProjectId(): string {
  return useParams<{ projectId: string }>().projectId;
}

/** Project + accepted measurement plan + counts (single request, cached per project). */
export function useProjectOverview() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["project", projectId, "overview"],
    queryFn: () => projectApi.overview(projectId),
  });
}
