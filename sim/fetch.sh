#!/bin/bash
# 下載 MLB 官方公開數據（2026、2025 季）到 sim/data/
set -e
D="$(cd "$(dirname "$0")" && pwd)/data"
mkdir -p "$D"
U="https://statsapi.mlb.com/api/v1/stats?stats=season&sportId=1&limit=3000&playerPool=ALL"
curl -s "$U&group=hitting&season=2026" -o "$D/hit.json"
curl -s "$U&group=pitching&season=2026" -o "$D/pit.json"
curl -s "$U&group=hitting&season=2025" -o "$D/hit25.json"
curl -s "$U&group=pitching&season=2025" -o "$D/pit25.json"
curl -s "$U&group=hitting&season=2024" -o "$D/hit24.json"
curl -s "$U&group=pitching&season=2024" -o "$D/pit24.json"
echo "已下載到 $D"
