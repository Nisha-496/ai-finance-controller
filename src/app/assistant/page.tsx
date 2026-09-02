import { Card, CardContent } from "@/components/ui/card";

export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm text-muted-foreground">Natural-language exception explanation and finance chat.</p>
      </div>
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Not built yet — this is Day 4's AI layer, deliberately last. The deterministic core above is fully working first.
        </CardContent>
      </Card>
    </div>
  );
}
