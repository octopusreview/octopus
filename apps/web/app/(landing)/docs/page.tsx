import { permanentRedirect } from "next/navigation";

export default function DocsIndex() {
  permanentRedirect("/docs/getting-started");
}
