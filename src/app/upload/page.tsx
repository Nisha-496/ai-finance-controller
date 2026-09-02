import { UploadPanel } from "@/components/upload/upload-panel";

export default function UploadPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload</h1>
        <p className="text-sm text-muted-foreground">Upload one CSV per source, then run reconciliation.</p>
      </div>
      <UploadPanel />
    </div>
  );
}
