"""Idempotent Lakebase Autoscale provisioning for Octopus.

Provisions: project → branch → endpoint with scale-to-zero.
Lakebase Autoscale ("databases.projects.*") is not yet declarable in the DAB
schema, so this script runs as a serverless Python job task in the bootstrap_job.

Re-runs are safe — existing resources are returned, not recreated.
"""

import argparse
import sys
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound, ResourceAlreadyExists
from databricks.sdk.service import database as db_svc


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--project", default="octopus-app", help="Lakebase project name")
    p.add_argument("--branch", default="production", help="Branch under the project")
    p.add_argument("--endpoint", default="ep-primary", help="Endpoint name under the branch")
    p.add_argument("--pg-version", default="17", help="Postgres version")
    p.add_argument("--min-cu", type=float, default=0.5)
    p.add_argument("--max-cu", type=float, default=2.0)
    p.add_argument("--scale-to-zero-seconds", type=int, default=300)
    return p.parse_args()


def wait_for_state(getter, target_states: set[str], poll_s: int = 5, timeout_s: int = 900) -> None:
    """Poll a resource until its state matches one of target_states."""
    elapsed = 0
    while elapsed < timeout_s:
        obj = getter()
        state = getattr(obj, "state", None) or getattr(getattr(obj, "status", None), "state", None)
        print(f"  state={state} (waited {elapsed}s)")
        if state and str(state).split(".")[-1].upper() in target_states:
            return
        time.sleep(poll_s)
        elapsed += poll_s
    raise TimeoutError(f"resource did not reach {target_states} within {timeout_s}s")


def ensure_project(w: WorkspaceClient, name: str, pg_version: str) -> None:
    try:
        existing = w.database.get_database_project(name)
        print(f"project {name} already exists (state={getattr(existing, 'state', '?')})")
        return
    except NotFound:
        pass
    print(f"creating project {name}...")
    try:
        w.database.create_database_project(
            database_project=db_svc.DatabaseProject(name=name, pg_version=pg_version),
        )
    except ResourceAlreadyExists:
        print(f"  project {name} created concurrently — continuing")
    wait_for_state(lambda: w.database.get_database_project(name), {"ACTIVE", "AVAILABLE"})


def ensure_branch(w: WorkspaceClient, project: str, branch: str) -> None:
    try:
        existing = w.database.get_database_branch(project, branch)
        print(f"branch {project}/{branch} already exists")
        return
    except NotFound:
        pass
    print(f"creating branch {project}/{branch}...")
    try:
        w.database.create_database_branch(
            project_name=project,
            database_branch=db_svc.DatabaseBranch(name=branch),
        )
    except ResourceAlreadyExists:
        print(f"  branch {branch} created concurrently — continuing")
    wait_for_state(lambda: w.database.get_database_branch(project, branch), {"ACTIVE", "AVAILABLE"})


def ensure_endpoint(
    w: WorkspaceClient,
    project: str,
    branch: str,
    endpoint: str,
    min_cu: float,
    max_cu: float,
    scale_to_zero_seconds: int,
) -> None:
    try:
        existing = w.database.get_database_endpoint(project, branch, endpoint)
        print(f"endpoint {project}/{branch}/{endpoint} already exists")
        return
    except NotFound:
        pass
    print(f"creating endpoint {endpoint} on {project}/{branch}...")
    try:
        w.database.create_database_endpoint(
            project_name=project,
            branch_name=branch,
            database_endpoint=db_svc.DatabaseEndpoint(
                name=endpoint,
                autoscaling_config=db_svc.AutoscalingConfig(
                    min_capacity_units=min_cu,
                    max_capacity_units=max_cu,
                    scale_to_zero_seconds=scale_to_zero_seconds,
                ),
            ),
        )
    except ResourceAlreadyExists:
        print(f"  endpoint {endpoint} created concurrently — continuing")
    wait_for_state(
        lambda: w.database.get_database_endpoint(project, branch, endpoint),
        {"ACTIVE", "AVAILABLE", "IDLE"},
    )


def main() -> int:
    args = parse_args()
    w = WorkspaceClient()
    print(f"Bootstrapping Lakebase: project={args.project} branch={args.branch} endpoint={args.endpoint}")

    ensure_project(w, args.project, args.pg_version)
    ensure_branch(w, args.project, args.branch)
    ensure_endpoint(
        w,
        args.project,
        args.branch,
        args.endpoint,
        args.min_cu,
        args.max_cu,
        args.scale_to_zero_seconds,
    )

    print("Lakebase bootstrap complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
