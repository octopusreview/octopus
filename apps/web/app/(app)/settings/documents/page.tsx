import { IconDownload } from "@tabler/icons-react";

const documents = [
  {
    title: "DPA",
    description:
      "Data Processing Agreement (DPA) is a contract that regulates data processing conducted for business purposes.",
    detail:
      "The attached DPA is a version signed by us, and is considered fully executed once you sign up to Octopus.",
    file: "/documents/dpa.pdf",
  },
];

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Documents</h2>
        <p className="text-muted-foreground text-sm">
          Download compliance and legal documents.
        </p>
      </div>

      <div className="space-y-4">
        {documents.map((doc) => (
          <div
            key={doc.title}
            className="rounded-lg border border-border p-6 space-y-3"
          >
            <h3 className="text-base font-semibold">{doc.title}</h3>
            <p className="text-muted-foreground text-sm">{doc.description}</p>
            <p className="text-muted-foreground text-sm">{doc.detail}</p>
            <a
              href={doc.file}
              download
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <IconDownload className="size-4" />
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
