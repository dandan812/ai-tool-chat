#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" != 0 ] || [ "$#" != 3 ]; then
  echo "Usage (root): install-first.sh staging-directory release-name release-sha256" >&2
  exit 2
fi
stage=$(realpath "$1")
release=$2
release_hash=$3
case "$stage" in /home/ubuntu/ai-tool-chat-stage-*) ;; *) echo "Unexpected staging path" >&2; exit 2 ;; esac
case "$release" in node-*[!0-9TZ-]*) echo "Invalid release" >&2; exit 2 ;; node-*) ;; *) exit 2 ;; esac
if [ "${#release_hash}" != 64 ]; then exit 2; fi
case "$release_hash" in *[!0-9a-f]*) exit 2 ;; esac
if [ "$(uname -m)" != x86_64 ]; then echo "Unsupported architecture" >&2; exit 2; fi
for target in /opt/ai-tool-chat /etc/ai-tool-chat /var/lib/ai-tool-chat /var/lib/ai-tool-chat-credentials /etc/systemd/system/ai-tool-chat.service; do
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "First-install target already exists; inspect state before any retry: $target" >&2
    exit 2
  fi
done
if getent passwd ai-tool-chat >/dev/null; then echo "Service account already exists" >&2; exit 2; fi
if ss -ltn | grep -qE ':3200[[:space:]]'; then echo "Port 3200 is occupied" >&2; exit 2; fi
if ! curl -fsS --max-time 5 http://127.0.0.1:8080/health >/dev/null; then
  echo "Existing relay is not healthy; refusing deployment" >&2
  exit 2
fi
cd "$stage"
printf '%s  %s\n' "$release_hash" "$release.tar.gz" | sha256sum -c -
printf '%s  %s\n' fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6 node-v24.21.0-linux-x64.tar.xz | sha256sum -c -

started=0
enabled=0
success=0
cleanup() {
  if [ "$success" != 1 ]; then
    if [ "$enabled" = 1 ]; then systemctl disable ai-tool-chat.service || true; fi
    if [ "$started" = 1 ]; then systemctl stop ai-tool-chat.service || true; fi
    echo "New application stopped after installation failure; relay was not restarted" >&2
  fi
}
trap cleanup EXIT

useradd --system --user-group --home-dir /var/lib/ai-tool-chat --no-create-home --shell /usr/sbin/nologin ai-tool-chat
install -d -m 0755 /opt/ai-tool-chat /opt/ai-tool-chat/runtimes /opt/ai-tool-chat/releases
install -d -m 0700 /opt/ai-tool-chat/backups /etc/ai-tool-chat
backup="/opt/ai-tool-chat/backups/first-install-$release"
install -d -m 0700 "$backup"
install -m 0600 /etc/caddy/Caddyfile "$backup/Caddyfile.before"
sha256sum /etc/caddy/Caddyfile > "$backup/Caddyfile.before.sha256"
docker inspect --format '{{.Name}} {{.Id}} restarts={{.RestartCount}}' sub2api sub2api-postgres sub2api-redis > "$backup/relay.before.txt"
tar -xJf node-v24.21.0-linux-x64.tar.xz -C /opt/ai-tool-chat/runtimes
ln -s runtimes/node-v24.21.0-linux-x64 /opt/ai-tool-chat/node
node=/opt/ai-tool-chat/node/bin/node
test "$("$node" --version)" = v24.21.0
install -d -m 0755 "/opt/ai-tool-chat/releases/$release"
tar -xzf "$release.tar.gz" -C "/opt/ai-tool-chat/releases/$release"
find "/opt/ai-tool-chat/releases/$release" -type d -exec chmod 0755 {} +
find "/opt/ai-tool-chat/releases/$release" -type f -exec chmod 0644 {} +
ln -s "releases/$release" /opt/ai-tool-chat/current
install -d -m 0700 -o ai-tool-chat -g ai-tool-chat /var/lib/ai-tool-chat /var/lib/ai-tool-chat-credentials
install -m 0600 /opt/ai-tool-chat/current/deployment/server.env.example /etc/ai-tool-chat/server.env
grep -qx 'PUBLIC_ORIGIN=https://chat.i-tool-chat.store' /etc/ai-tool-chat/server.env
grep -qx 'ENVIRONMENT=production' /etc/ai-tool-chat/server.env
grep -qx 'ALLOW_REGISTRATION=false' /etc/ai-tool-chat/server.env
grep -qx 'MOCK_MODEL=false' /etc/ai-tool-chat/server.env
install -m 0644 /opt/ai-tool-chat/current/deployment/ai-tool-chat.service /etc/systemd/system/ai-tool-chat.service
systemd-analyze verify /etc/systemd/system/ai-tool-chat.service
runuser -u ai-tool-chat -- env DATA_DIRECTORY=/var/lib/ai-tool-chat \
  "$node" /opt/ai-tool-chat/current/backend/admin.mjs owner /var/lib/ai-tool-chat-credentials/owner.txt

# Database and objects are captured together while the new application is stopped.
tar -czf "$backup/initial-state.tar.gz" -C / var/lib/ai-tool-chat var/lib/ai-tool-chat-credentials etc/ai-tool-chat
chmod 0600 "$backup/initial-state.tar.gz"
install -d -m 0700 "$backup/restore-check"
tar -xzf "$backup/initial-state.tar.gz" -C "$backup/restore-check"
"$node" --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(process.argv[1], {readOnly:true});
  if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Backup integrity failure");
  const count = db.prepare("SELECT count(*) AS n FROM kv WHERE ns=? AND key LIKE ?").get("accounts", "user:%").n;
  if (count !== 1) throw new Error("Owner missing from restored backup");
  db.close();
  console.log("Initial backup restore verified");
' "$backup/restore-check/var/lib/ai-tool-chat/state.sqlite"
systemctl daemon-reload
started=1
systemctl start ai-tool-chat.service
attempt=0
until curl -fsS --max-time 2 http://127.0.0.1:3200/healthz >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then echo "New service health check failed" >&2; exit 1; fi
  sleep 1
done
curl -fsS --max-time 5 http://127.0.0.1:8080/health >/dev/null
docker inspect --format '{{.Name}} {{.Id}} restarts={{.RestartCount}}' sub2api sub2api-postgres sub2api-redis > "$backup/relay.after.txt"
cmp "$backup/relay.before.txt" "$backup/relay.after.txt"
sha256sum -c "$backup/Caddyfile.before.sha256"
enabled=1
systemctl enable ai-tool-chat.service
printf '%s\n' "$release" > /opt/ai-tool-chat/installed-release
success=1
echo "Independent Node service installed; public DNS/TLS and model configuration still require verification"
