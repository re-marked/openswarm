#!/bin/sh
mkdir -p /data/agents/main/agent
echo "{\"version\":1,\"profiles\":{\"google:default\":{\"type\":\"api_key\",\"provider\":\"google\",\"key\":\"${GOOGLE_API_KEY}\"}},\"lastGood\":{\"google\":\"google:default\"}}" > /data/agents/main/agent/auth-profiles.json
exec node /app/dist/index.js gateway --bind lan --port ${OPENCLAW_PORT:-18789} --allow-unconfigured
