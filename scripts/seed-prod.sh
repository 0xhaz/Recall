#!/usr/bin/env bash
# Migrate and seed the deployed database. Run this yourself: it writes to production.
#
# It replaces the demo household's rules, routines, activity, care plan, reminders, notices,
# context baselines and seeded purchases, so the demo is identical every time. It does NOT touch
# people, memberships, household tokens, or any fact that is not part of the seed.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
export AWS_PAGER=""

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
