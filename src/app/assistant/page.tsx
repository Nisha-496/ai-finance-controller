import { AssistantChat } from "@/components/assistant/chat";

export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm text-muted-foreground">Natural-language finance chat — grounded in live reconciliation data, never free database access.</p>
      </div>
      <AssistantChat />
    </div>
  );
}
