"""Idempotent Vector Search Direct Access index provisioning for Octopus.

Creates 7 indexes on a shared endpoint, one per Qdrant collection that the
app uses:

  code_chunks          (repo source)
  knowledge_chunks     (org knowledge docs)
  review_chunks        (past PR findings)
  chat_chunks          (Q&A history)
  flowchart_chunks     (Mermaid diagrams from past reviews)
  docs_chunks          (public docs / landing-page content)
  feedback_patterns    (repo-specific review patterns)

All are 1024-dim cosine (matches Databricks AI Gateway's
`databricks-gte-large-en` embedding output). For local dev with OpenAI's
text-embedding-3-large, override `--dimension 3072`.
Re-runs are safe — existing indexes are skipped.
"""

import argparse
import json
import sys
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound, ResourceAlreadyExists
from databricks.sdk.service.vectorsearch import (
    DirectAccessVectorIndexSpec,
    EmbeddingVectorColumn,
    VectorIndexType,
)


# Index name → list of metadata column definitions for the schema_json.
INDEXES: dict[str, dict] = {
    "code_chunks": {
        "id": "string",
        "embedding": "array<float>",
        "text": "string",
        "repoId": "string",
        "filePath": "string",
        "startLine": "int",
        "endLine": "int",
        "originalId": "string",
    },
    "knowledge_chunks": {
        "id": "string",
        "embedding": "array<float>",
        "text": "string",
        "orgId": "string",
        "documentId": "string",
        "title": "string",
        "originalId": "string",
    },
    "review_chunks": {
        "id": "string",
        "embedding": "array<float>",
        "text": "string",
        "orgId": "string",
        "repoId": "string",
        "pullRequestId": "string",
        "prTitle": "string",
        "prNumber": "int",
        "repoFullName": "string",
        "author": "string",
        "reviewDate": "string",
        "originalId": "string",
    },
    "chat_chunks": {
        "id": "string",
        "embedding": "array<float>",
        "question": "string",
        "answer": "string",
        "orgId": "string",
        "userId": "string",
        "conversationId": "string",
        "conversationTitle": "string",
        "originalId": "string",
    },
    "flowchart_chunks": {
        "id": "string",
        "embedding": "array<float>",
        "mermaidCode": "string",
        "diagramType": "string",
        "orgId": "string",
        "repoId": "string",
        "pullRequestId": "string",
        "prTitle": "string",
        "prNumber": "int",
        "repoFullName": "string",
        "author": "string",
        "reviewDate": "string",
        "originalId": "string",
    },
    "docs_chunks": {
        "id": "string",
        "embedding": "array<float>",
        "text": "string",
        "page": "string",
        "section": "string",
        "title": "string",
        "originalId": "string",
    },
    "feedback_patterns": {
        "id": "string",
        "embedding": "array<float>",
        "title": "string",
        "description": "string",
        "feedback": "string",
        "repoId": "string",
        "orgId": "string",
        "issueId": "string",
        "originalId": "string",
    },
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint", required=True, help="Vector Search endpoint name")
    p.add_argument("--catalog", default="octopus_ai_catalog")
    p.add_argument("--schema", default="vectors")
    p.add_argument("--dimension", type=int, default=1024)
    return p.parse_args()


def wait_for_endpoint(w: WorkspaceClient, endpoint: str, timeout_s: int = 1200) -> None:
    elapsed = 0
    while elapsed < timeout_s:
        ep = w.vector_search_endpoints.get_endpoint(endpoint)
        state = (ep.endpoint_status.state if ep.endpoint_status else None) or "?"
        # SDK returns an enum (e.g. EndpointStatusState.ONLINE); take the last
        # path component for a simple string match.
        state_name = str(state).rsplit(".", 1)[-1].upper()
        print(f"  endpoint {endpoint} state={state_name} (waited {elapsed}s)")
        if state_name in {"ONLINE", "ACTIVE"}:
            return
        time.sleep(15)
        elapsed += 15
    raise TimeoutError(f"endpoint {endpoint} not ONLINE within {timeout_s}s")


def ensure_schema(w: WorkspaceClient, catalog: str, schema: str) -> None:
    """Create the UC schema if missing (idempotent)."""
    try:
        w.schemas.get(f"{catalog}.{schema}")
        print(f"schema {catalog}.{schema} exists")
        return
    except NotFound:
        pass
    print(f"creating schema {catalog}.{schema}...")
    try:
        w.schemas.create(name=schema, catalog_name=catalog)
    except ResourceAlreadyExists:
        pass


def ensure_index(
    w: WorkspaceClient,
    endpoint: str,
    catalog: str,
    schema: str,
    index_name: str,
    columns: dict[str, str],
    dimension: int,
) -> None:
    full_name = f"{catalog}.{schema}.{index_name}"
    try:
        w.vector_search_indexes.get_index(full_name)
        print(f"index {full_name} already exists")
        return
    except NotFound:
        pass

    print(f"creating index {full_name}...")
    spec = DirectAccessVectorIndexSpec(
        embedding_vector_columns=[
            EmbeddingVectorColumn(name="embedding", embedding_dimension=dimension),
        ],
        schema_json=json.dumps(columns),
    )
    try:
        w.vector_search_indexes.create_index(
            name=full_name,
            endpoint_name=endpoint,
            primary_key="id",
            index_type=VectorIndexType.DIRECT_ACCESS,
            direct_access_index_spec=spec,
        )
    except ResourceAlreadyExists:
        print(f"  {full_name} created concurrently — continuing")
        return
    print(f"  → {full_name} created")


def main() -> int:
    args = parse_args()
    w = WorkspaceClient()
    print(f"Bootstrapping VS indexes on endpoint={args.endpoint} catalog={args.catalog} schema={args.schema}")

    wait_for_endpoint(w, args.endpoint)
    ensure_schema(w, args.catalog, args.schema)

    for index_name, columns in INDEXES.items():
        ensure_index(
            w,
            args.endpoint,
            args.catalog,
            args.schema,
            index_name,
            columns,
            args.dimension,
        )

    print("VS index bootstrap complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
