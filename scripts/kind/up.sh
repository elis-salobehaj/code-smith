#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-code-smith}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
NAMESPACE="${K8S_NAMESPACE:-code-smith}"
IMAGE_TAG="${KIND_IMAGE_TAG:-code-smith:latest}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  if [[ -z "${!1:-}" ]]; then
    echo "Missing required environment variable in ${ENV_FILE}: $1" >&2
    exit 1
  fi
}

require_command docker
require_command kind
require_command kubectl

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

require_env GITLAB_URL
require_env GITLAB_TOKEN
require_env GITLAB_WEBHOOK_SECRET
require_env AWS_BEARER_TOKEN_BEDROCK

AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_AUTH_SCHEME_PREFERENCE="${AWS_AUTH_SCHEME_PREFERENCE:-smithy.api#httpBearerAuth}"
LLM_MODEL="${LLM_MODEL:-global.anthropic.claude-sonnet-4-6}"
MAX_TOOL_ITERATIONS="${MAX_TOOL_ITERATIONS:-15}"
MAX_SEARCH_RESULTS="${MAX_SEARCH_RESULTS:-100}"
REPO_CACHE_DIR="${REPO_CACHE_DIR:-/tmp/repo_cache}"
LOG_LEVEL="${LOG_LEVEL:-info}"
WORKER_CONCURRENCY="${WORKER_CONCURRENCY:-2}"
REVIEW_JOB_TIMEOUT_MS="${REVIEW_JOB_TIMEOUT_MS:-600000}"
LLM_PROVIDER_ORDER="${LLM_PROVIDER_ORDER:-bedrock}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o}"
GOOGLE_AI_MODEL="${GOOGLE_AI_MODEL:-gemini-1.5-pro}"
JIRA_ENABLED="${JIRA_ENABLED:-false}"
JIRA_PROJECT_KEYS="${JIRA_PROJECT_KEYS:-}"
JIRA_ACCEPTANCE_CRITERIA_FIELD_ID="${JIRA_ACCEPTANCE_CRITERIA_FIELD_ID:-}"
JIRA_MAX_TICKETS="${JIRA_MAX_TICKETS:-5}"
JIRA_TICKET_TIMEOUT_MS="${JIRA_TICKET_TIMEOUT_MS:-5000}"

if [[ -n "${PORT:-}" && "${PORT}" != "8020" ]]; then
  echo "Ignoring PORT=${PORT} for KinD bootstrap; manifests and probes are fixed to port 8020"
fi
PORT="8020"

if kind get clusters | grep -Fxq "${CLUSTER_NAME}"; then
  echo "KinD cluster '${CLUSTER_NAME}' already exists"
else
  kind create cluster --name "${CLUSTER_NAME}"
fi

kubectl config use-context "${KUBE_CONTEXT}" >/dev/null

echo "Building local image ${IMAGE_TAG}"
docker build -t "${IMAGE_TAG}" "${ROOT_DIR}"

echo "Loading image into KinD"
kind load docker-image "${IMAGE_TAG}" --name "${CLUSTER_NAME}"

echo "Applying namespace"
kubectl apply -f "${ROOT_DIR}/k8s/namespace.yaml"

configmap_args=(
  create configmap code-smith-config
  --namespace "${NAMESPACE}"
  --from-literal=GITLAB_URL="${GITLAB_URL}"
  --from-literal=AWS_REGION="${AWS_REGION}"
  --from-literal=AWS_AUTH_SCHEME_PREFERENCE="${AWS_AUTH_SCHEME_PREFERENCE}"
  --from-literal=LLM_MODEL="${LLM_MODEL}"
  --from-literal=LLM_PROVIDER_ORDER="${LLM_PROVIDER_ORDER}"
  --from-literal=MAX_TOOL_ITERATIONS="${MAX_TOOL_ITERATIONS}"
  --from-literal=MAX_SEARCH_RESULTS="${MAX_SEARCH_RESULTS}"
  --from-literal=REPO_CACHE_DIR="${REPO_CACHE_DIR}"
  --from-literal=LOG_LEVEL="${LOG_LEVEL}"
  --from-literal=PORT="${PORT}"
  --from-literal=QUEUE_ENABLED=true
  --from-literal=WORKER_CONCURRENCY="${WORKER_CONCURRENCY}"
  --from-literal=REVIEW_JOB_TIMEOUT_MS="${REVIEW_JOB_TIMEOUT_MS}"
  --from-literal=JIRA_ENABLED="${JIRA_ENABLED}"
  --from-literal=JIRA_MAX_TICKETS="${JIRA_MAX_TICKETS}"
  --from-literal=JIRA_TICKET_TIMEOUT_MS="${JIRA_TICKET_TIMEOUT_MS}"
  --from-literal=OPENAI_MODEL="${OPENAI_MODEL}"
  --from-literal=GOOGLE_AI_MODEL="${GOOGLE_AI_MODEL}"
)

if [[ -n "${JIRA_PROJECT_KEYS}" ]]; then
  configmap_args+=(--from-literal=JIRA_PROJECT_KEYS="${JIRA_PROJECT_KEYS}")
fi

if [[ -n "${JIRA_ACCEPTANCE_CRITERIA_FIELD_ID}" ]]; then
  configmap_args+=(--from-literal=JIRA_ACCEPTANCE_CRITERIA_FIELD_ID="${JIRA_ACCEPTANCE_CRITERIA_FIELD_ID}")
fi

kubectl "${configmap_args[@]}" --dry-run=client -o yaml | kubectl apply -f -

secret_args=(
  create secret generic code-smith-secrets
  --namespace "${NAMESPACE}"
  --from-literal=GITLAB_TOKEN="${GITLAB_TOKEN}"
  --from-literal=GITLAB_WEBHOOK_SECRET="${GITLAB_WEBHOOK_SECRET}"
  --from-literal=AWS_BEARER_TOKEN_BEDROCK="${AWS_BEARER_TOKEN_BEDROCK}"
  --from-literal=VALKEY_URL=redis://valkey:6379
)

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  secret_args+=(--from-literal=OPENAI_API_KEY="${OPENAI_API_KEY}")
fi

if [[ -n "${GOOGLE_AI_API_KEY:-}" ]]; then
  secret_args+=(--from-literal=GOOGLE_AI_API_KEY="${GOOGLE_AI_API_KEY}")
fi

if [[ -n "${JIRA_BASE_URL:-}" ]]; then
  secret_args+=(--from-literal=JIRA_BASE_URL="${JIRA_BASE_URL}")
fi

if [[ -n "${JIRA_EMAIL:-}" ]]; then
  secret_args+=(--from-literal=JIRA_EMAIL="${JIRA_EMAIL}")
fi

if [[ -n "${JIRA_API_TOKEN:-}" ]]; then
  secret_args+=(--from-literal=JIRA_API_TOKEN="${JIRA_API_TOKEN}")
fi

kubectl "${secret_args[@]}" --dry-run=client -o yaml | kubectl apply -f -

if [[ -n "${GITLAB_CA_FILE:-}" ]]; then
  if [[ ! -f "${GITLAB_CA_FILE}" ]]; then
    echo "Configured GITLAB_CA_FILE does not exist: ${GITLAB_CA_FILE}" >&2
    exit 1
  fi

  kubectl create secret generic gitlab-ca-bundle \
    --namespace "${NAMESPACE}" \
    --from-file=ca.pem="${GITLAB_CA_FILE}" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

echo "Applying manifests"
kubectl apply -f "${ROOT_DIR}/k8s/valkey.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/service.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/deployment.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/worker-deployment.yaml"

if [[ -n "${GITLAB_CA_FILE:-}" ]]; then
  kubectl patch deployment code-smith-webhook --namespace "${NAMESPACE}" --type merge -p '{"spec":{"template":{"spec":{"volumes":[{"name":"gitlab-ca-bundle","secret":{"secretName":"gitlab-ca-bundle"}}],"containers":[{"name":"webhook","env":[{"name":"GITLAB_CA_FILE","value":"/etc/gitlab-ca/ca.pem"}],"volumeMounts":[{"name":"gitlab-ca-bundle","mountPath":"/etc/gitlab-ca","readOnly":true}]}]}}}}'
  kubectl patch deployment code-smith-worker --namespace "${NAMESPACE}" --type merge -p '{"spec":{"template":{"spec":{"volumes":[{"name":"gitlab-ca-bundle","secret":{"secretName":"gitlab-ca-bundle"}}],"containers":[{"name":"worker","env":[{"name":"GITLAB_CA_FILE","value":"/etc/gitlab-ca/ca.pem"}],"volumeMounts":[{"name":"gitlab-ca-bundle","mountPath":"/etc/gitlab-ca","readOnly":true}]}]}}}}'
fi

kubectl set image deployment/code-smith-webhook webhook="${IMAGE_TAG}" --namespace "${NAMESPACE}" >/dev/null
kubectl set image deployment/code-smith-worker worker="${IMAGE_TAG}" --namespace "${NAMESPACE}" >/dev/null

kubectl rollout restart deployment/code-smith-webhook --namespace "${NAMESPACE}" >/dev/null
kubectl rollout restart deployment/code-smith-worker --namespace "${NAMESPACE}" >/dev/null

echo "Waiting for rollouts"
kubectl rollout status deployment/valkey --namespace "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/code-smith-webhook --namespace "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/code-smith-worker --namespace "${NAMESPACE}" --timeout=180s

echo
echo "KinD environment is ready."
echo "Expose the webhook locally with: bun run kind:port-forward"
echo "Health check after port-forward: curl http://127.0.0.1:8020/api/v1/health"