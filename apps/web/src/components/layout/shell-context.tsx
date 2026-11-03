"use client";

import * as React from "react";

interface ShellContextValue {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  /** Project currently open in the workspace (gives the assistant its context). */
  projectContext: { id: string; title: string } | null;
  setProjectContext: (ctx: { id: string; title: string } | null) => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [projectContext, setProjectContext] = React.useState<{ id: string; title: string } | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !e.isComposing) {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = React.useMemo(
    () => ({
      commandOpen,
      setCommandOpen,
      assistantOpen,
      setAssistantOpen,
      projectContext,
      setProjectContext,
    }),
    [commandOpen, assistantOpen, projectContext],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

/** Register the open project as the assistant's context while a workspace page is mounted. */
export function useProjectContext(project: { id: string; title: string } | undefined): void {
  const { setProjectContext } = useShell();
  React.useEffect(() => {
    if (!project) return;
    setProjectContext({ id: project.id, title: project.title });
    return () => setProjectContext(null);
  }, [project?.id, project?.title, setProjectContext]); // eslint-disable-line react-hooks/exhaustive-deps
}
