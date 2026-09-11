#!/bin/sh
set -eu

api_url=${API_URL:-http://127.0.0.1:3001}
web_url=${WEB_URL:-http://127.0.0.1:3000}

check() {
  name=$1
  url=$2
  status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 "$url")
  case "$status" in
    2*) echo "$name: OK ($status)" ;;
    *) echo "$name: FAIL ($status)" >&2; exit 1 ;;
  esac
}

check "api health" "$api_url/health"
check "api readiness" "$api_url/ready"
check "web" "$web_url/login"
