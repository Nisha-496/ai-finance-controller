import { Sparkles } from "lucide-react";
import { AssistantChat } from "@/components/assistant/chat";
import { PageHeader } from "@/components/page-header";

export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Sparkles}
        title="Assistant"
        description="Natural-language finance chat — grounded in live reconciliation data, never free database access."
      />
      <AssistantChat />
    </div>
  );
}
