# Kubernetes Manifests

Raw k8s manifests targeting standard Kubernetes primitives (Deployments, Services,
ConfigMaps, Secrets). No cloud-specific features — compatible with KinD, EKS, GKE,
and any CNCF-conformant cluster.

## Apply order

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml        # fill in REPLACE_ME values first
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/valkey.yaml        # dev/KinD only — see note below
```

## Local KinD workflow

For local validation, prefer the bootstrap scripts over editing `secret.yaml` by hand:

```bash
bun run kind:up
bun run kind:port-forward
```

`bun run kind:up` creates a KinD cluster, builds and loads the local `code-smith:latest`
image, generates the ConfigMap and Secret from your local `.env`, deploys the manifests,
and waits for rollouts to complete. `bun run kind:port-forward` then exposes the ClusterIP
Service on `http://127.0.0.1:8020`.

To tear the cluster down:

```bash
bun run kind:down
```

## Files

| File | Purpose |
|---|---|
| `namespace.yaml` | `code-smith` namespace |
| `configmap.yaml` | Non-sensitive config (GitLab URL, LLM model, queue settings) |
| `secret.yaml` | Sensitive values — replace `REPLACE_ME` placeholders before applying |
| `deployment.yaml` | Webhook server (2 replicas, readiness/liveness probes) |
| `worker-deployment.yaml` | BullMQ worker (1 replica, 660s gracePeriod for in-flight reviews) |
| `service.yaml` | ClusterIP Service mapping port 80 → 8020 |
| `valkey.yaml` | Valkey Deployment + Service — **dev/KinD only** |

## `valkey.yaml` is for dev/KinD only

`valkey.yaml` deploys an in-cluster Valkey instance with no persistence. It is
appropriate for local development with KinD or integration testing. For production,
use a managed Redis-compatible service (AWS ElastiCache, GCP Memorystore, etc.) and
point `VALKEY_URL` in `secret.yaml` at that endpoint instead.

## Secrets

Before applying `secret.yaml`, replace all `REPLACE_ME` placeholders with real values.
For production, consider managing secrets with Sealed Secrets, the External Secrets
Operator, or your cloud provider's native secret store instead of committing raw values
to version control.

For local KinD, the bootstrap scripts avoid storing real secrets in Git by generating the
Secret from `.env` at apply time instead of applying `k8s/secret.yaml` directly.

## Ingress

No Ingress manifest is included — cluster ingress setup varies too much between
environments. Expose the `code-smith-webhook` Service via an Ingress or LoadBalancer
Service appropriate for your cluster.

See [docs/guides/GETTING_STARTED.md](../docs/guides/GETTING_STARTED.md) for full
environment variable reference and queue/worker setup instructions.
