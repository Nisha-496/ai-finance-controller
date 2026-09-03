import { Upload } from "lucide-react";
import { UploadPanel } from "@/components/upload/upload-panel";
import { PageHeader } from "@/components/page-header";

export default function UploadPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Upload} title="Upload" description="Upload one CSV per source, then run reconciliation." />
      <UploadPanel />
    </div>
  );
}
