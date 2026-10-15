#!/usr/bin/env bash
# Seed the deployed demo household — from inside the VPC, by asking the server container to do it
# on its next boot.
#
# The obvious way is to connect to RDS from here and run `pnpm seed`. Don't: the database only
# admits named addresses, a home IP moves, and "just add my IP" means re-opening that hole every
# time and forgetting to close it. The container is already in the VPC and already runs migrations
# on boot, so it is the right thing to hand this to.
#
# Two deployments: one with SEED_ON_BOOT=on, one to take it off again. Leaving it on would re-seed
# on every restart, which is idempotent but would wipe anything entered during a live demo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REGION="${AWS_REGION:-us-east-1}"
SERVICE="${SERVICE:-recall-server}"
export AWS_PAGER=""

arn="$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='$SERVICE'].ServiceArn" --output text)"
[ -n "$arn" ] && [ "$arn" != "None" ] || { echo "No such service: $SERVICE" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Flip SEED_ON_BOOT, keeping every other environment variable exactly as it is.
set_flag() {
  aws apprunner describe-service --service-arn "$arn" --region "$REGION" \
    --query 'Service.SourceConfiguration' --output json > "$tmp/config.json"
  FLAG="$1" python3 - "$tmp/config.json" <<'PY'
import json, os, sys
path = sys.argv[1]
cfg = json.load(open(path))
env = cfg['ImageRepository']['ImageConfiguration']['RuntimeEnvironmentVariables']
flag = os.environ['FLAG']
if flag == 'off':
    env.pop('SEED_ON_BOOT', None)
else:
    env['SEED_ON_BOOT'] = flag
json.dump(cfg, open(path, 'w'))
PY
  aws apprunner update-service --service-arn "$arn" --region "$REGION" \
    --source-configuration "file://$tmp/config.json" --query 'OperationId' --output text >/dev/null
}

wait_ready() {
  while :; do
    status="$(aws apprunner list-services --region "$REGION" \
      --query "ServiceSummaryList[?ServiceName=='$SERVICE'].Status" --output text)"
    [ "$status" = "OPERATION_IN_PROGRESS" ] || { echo "$status"; return 0; }
    sleep 10
  done
}

echo "==> asking $SERVICE to seed on its next boot"
set_flag on
echo "    $(wait_ready)"

echo "==> taking the flag off again, so a restart does not re-seed"
set_flag off
echo "    $(wait_ready)"

url="$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='$SERVICE'].ServiceUrl" --output text)"
curl -fsS "https://$url/health"; echo
echo
echo "Seeded. Check the application log for 'seeded demo households' if you want to see it happen:"
echo "  aws logs tail /aws/apprunner/$SERVICE/\$(aws apprunner describe-service --service-arn $arn \\"
echo "    --region $REGION --query 'Service.ServiceId' --output text)/application --since 15m --region $REGION"
