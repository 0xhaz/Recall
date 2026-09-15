#!/usr/bin/env bash
# Build, push and deploy both services to App Runner.
#
# Every flag here is load-bearing, and each one cost an afternoon to find:
#   --platform linux/amd64   App Runner is x86_64. An arm64 image deploys cleanly and then dies at
#                            runtime with "exec format error".
#   --provenance/--sbom      buildx attestations add unknown/unknown manifest entries. App Runner
#                            pulls the image, fails, and logs nothing at all.
#   start-deployment         update-service does NOT re-pull a moved :latest tag, even though the
#                            console then shows the service as updated.
set -euo pipefail

ACCOUNT="${AWS_ACCOUNT_ID:-333798927101}"
REGION="${AWS_REGION:-us-east-1}"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
DEPLOY_ID="$(git rev-parse --short HEAD)"
export AWS_PAGER=""

echo "==> deploying $DEPLOY_ID to $REGION"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

build() { # repo, dockerfile, extra args...
  local repo="$1" file="$2"; shift 2
  echo "==> building $repo"
  docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
    -f "$file" -t "$REGISTRY/$repo:latest" "$@" --push .
}

build recall-server apps/mcp-server/Dockerfile
build recall-console apps/console/Dockerfile --build-arg "NEXT_DEPLOYMENT_ID=$DEPLOY_ID"

for svc in recall-server recall-console; do
  arn="$(aws apprunner list-services --region "$REGION" \
    --query "ServiceSummaryList[?ServiceName=='$svc'].ServiceArn" --output text)"
  echo "==> deploying $svc"
  aws apprunner start-deployment --service-arn "$arn" --region "$REGION" --query OperationId --output text
done

echo "==> waiting"
while :; do
  statuses="$(aws apprunner list-services --region "$REGION" \
    --query "ServiceSummaryList[?starts_with(ServiceName,'recall-')].Status" --output text)"
  case "$statuses" in *OPERATION_IN_PROGRESS*) sleep 10;; *) echo "$statuses"; break;; esac
done

curl -fsS "https://$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='recall-server'].ServiceUrl" --output text)/health"
echo
echo "Deployed. The database is a separate step — see scripts/seed-prod.sh."
