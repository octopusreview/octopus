import { getGlobalBlockedAuthors } from "../model-actions";
import { BlockedAuthorsManager } from "../blocked-authors-manager";

export default async function AdminBlockedAuthorsPage() {
  const authors = await getGlobalBlockedAuthors();

  return <BlockedAuthorsManager initialAuthors={authors} />;
}
