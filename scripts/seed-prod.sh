#!/usr/bin/env bash
# Migrate and seed the deployed database. Run this yourself: it writes to production.
#
# It replaces the demo household's rules, routines, activity, care plan, reminders, notices,
# context baselines and seeded purchases, so the demo is identical every time. It does NOT touch
# people, memberships, household tokens, or any fact that is not part of the seed.
set -euo pipefail

# pnpm --filter runs the child with cwd set to the package directory, so every path here is
# absolute: a relative NODE_EXTRA_CA_CERTS would silently resolve against apps/mcp-server.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REGION="${AWS_REGION:-us-east-1}"
export AWS_PAGER=""

# RDS presents a chain rooted in "Amazon RDS Root 2019 CA", which is not in Node's trust store, so
# a laptop gets SELF_SIGNED_CERT_IN_CHAIN even though the connection is perfectly good. The URL uses
# sslmode=verify-full and should keep doing so: the fix is to trust Amazon's CA, never to turn
# verification off. (NODE_TLS_REJECT_UNAUTHORIZED=0 would "work" here and would also disable
# certificate checking for every other connection the process makes.)
CA_BUNDLE="${NODE_EXTRA_CA_CERTS:-$ROOT/.cache/rds-global-bundle.pem}"
if [ ! -s "$CA_BUNDLE" ]; then
  echo "==> fetching Amazon's RDS CA bundle"
  mkdir -p "$(dirname "$CA_BUNDLE")"
  curl -fsS --max-time 60 -o "$CA_BUNDLE" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
fi
export NODE_EXTRA_CA_CERTS="$CA_BUNDLE"

arn="$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='recall-server'].ServiceArn" --output text)"
DATABASE_URL="$(aws apprunner describe-service --service-arn "$arn" --region "$REGION" \
  --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.DATABASE_URL' \
  --output text)"
export DATABASE_URL

echo "==> migrating"
pnpm --filter @recall/mcp-server migrate
echo "==> seeding"
pnpm --filter @recall/mcp-server seed
echo "Done. Sign in to the console and every page should have something on it."
