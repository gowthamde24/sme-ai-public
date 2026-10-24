#!/usr/bin/env bash
# Make Docker ready for the local Supabase stacks: Colima (job DE; it replaced OrbStack, which is not free for business use). Safe to run any time: it only does what is missing.
#   scripts/docker-up.sh            then `make db-start` (owner stack) and `make agent-db-up` (agent stack)
# Sizing: 2 CPUs, 4 GB, 40 GB disk, Apple's virtualization framework (vz) with virtiofs mounts. Why: the Mac has 8 GB; the two Supabase stacks together use about 2 GB inside the VM (owner 0.9 GB with Studio, agent 0.9 GB),
# so 4 GB holds both with room, leaves macOS and the browser about 4 GB, and 2 CPUs are enough for a database and its small services. To change it: edit the numbers here and run `colima stop && scripts/docker-up.sh`.
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
VOLUME="/Volumes/Stack19"
IMAGE="/Volumes/Gowtham SSD/Stack19.sparsebundle"

command -v colima >/dev/null || { echo "Colima is not installed: brew install colima docker docker-credential-helper" >&2; exit 1; }

# 1. The Stack19 volume (a sparsebundle on the SSD that holds the repository) must be mounted BEFORE the engine starts. The containers bind-mount files from it (Kong its e-mail templates, the database its init scripts); if the
#    volume is missing when a container is (re)started the mount fails ("mkdir /Volumes/Stack19: permission denied"), the container exits with code 255 and, with restart policy unless-stopped, is never tried again.
#    That is why the agent stack once ran "without its API gateway" (job DB's report): Kong had died that way when the engine restarted before the volume was mounted.
if [ ! -d "$VOLUME/stack19" ]; then
  echo "mounting $VOLUME ..."
  diskutil mount Stack19 >/dev/null 2>&1 || hdiutil attach "$IMAGE" >/dev/null 2>&1 || true
  [ -d "$VOLUME/stack19" ] || { echo "The Stack19 volume is not available ($IMAGE: is the SSD plugged in?)" >&2; exit 1; }
fi

# 2. the engine
if ! colima status >/dev/null 2>&1; then
  echo "starting Colima ..."
  colima start --cpu 2 --memory 4 --disk 40 --vm-type vz --mount-type virtiofs --mount "$VOLUME:w" --mount "$HOME:r"
fi

# 3. every docker command (make targets, the Supabase CLI, the e2e helpers, the demo scripts) talks to Colima
docker context use colima >/dev/null
docker info >/dev/null 2>&1 || { echo "Docker does not answer (docker context: $(docker context show))" >&2; exit 1; }

# 4. a Supabase container that died while the engine or the volume was away is started again (a plain `docker start`; nothing is created or deleted)
dead="$(docker ps -a --filter status=exited --filter name=supabase_ --format '{{.Names}}' | tr '\n' ' ')"
if [ -n "$dead" ]; then echo "starting stopped Supabase containers: $dead"; docker start $dead >/dev/null; fi
echo "docker ready: $(docker context show), $(docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes')"
