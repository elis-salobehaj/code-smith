#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-code-smith}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
NAMESPACE="${K8S_NAMESPACE:-code-smith}"
LOCAL_PORT="${LOCAL_PORT:-8020}"
REMOTE_PORT="${REMOTE_PORT:-80}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "Missing required command: kubectl" >&2
  exit 1
fi

kubectl config use-context "${KUBE_CONTEXT}" >/dev/null
exec kubectl port-forward service/code-smith --namespace "${NAMESPACE}" "${LOCAL_PORT}:${REMOTE_PORT}"