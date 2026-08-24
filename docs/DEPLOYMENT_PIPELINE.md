# hforge CI/CD pipeline

The repository now has a pull-request and `main` CI workflow plus a deliberately manual production deployment. CI proves the application can install, test, build, parse, and compose locally; the manual CD workflow publishes immutable images and updates the existing Azure VM without replacing its runtime data or secrets.

## Quick path

1. Configure the required repository secrets described below.
2. Open **Actions → Deploy → Run workflow** and select the commit or branch to deploy.
3. Confirm that the workflow publishes both SHA-tagged images and passes the local and public health checks.

The production endpoint is:

```text
https://hforge.westeurope.cloudapp.azure.com/api/health
```

## CI behavior

`.github/workflows/ci.yml` runs for every pull request and every push to `main`:

- Frontend: Node.js 22, `npm ci`, `npm test`, and `npm run build`.
- API: Node.js 22, `npm ci`, and `node --check server.js`.
- Compose: validates the local Compose file with a temporary CI-only `.env`, then builds the local `api` and `web` services.

The temporary `.env` exists only during the CI job and is never committed.

## Manual CD behavior

`.github/workflows/deploy.yml` is triggered only by `workflow_dispatch`. For the selected commit it:

1. Builds `api` and `web` Docker images.
2. Pushes them to GHCR as `ghcr.io/h5uarez/hforge-api:<commit-sha>` and `ghcr.io/h5uarez/hforge-web:<commit-sha>`.
3. Uploads only `docker-compose.prod.yml` to `/opt/hforge`.
4. Logs Docker into GHCR on the VM through `--password-stdin`, pulls the immutable SHA tags, and restarts the production Compose services.
5. Checks the local VM endpoint and then checks the public HTTPS endpoint.

The workflow uses strict SSH host-key verification. It does not print the SSH key or GHCR read token.

## Required GitHub Actions secrets

| Secret | Value |
| --- | --- |
| `AZURE_VM_HOST` | The Azure VM hostname or public IP used for SSH. |
| `AZURE_VM_USER` | The Linux user that owns or can operate `/opt/hforge`. |
| `AZURE_SSH_PRIVATE_KEY` | The private SSH key for that user, including its original line breaks. |
| `AZURE_VM_KNOWN_HOSTS` | The verified `known_hosts` line(s) for the VM SSH host. |
| `GHCR_USERNAME` | The GitHub account or machine-user name used by the VM to pull images. |
| `GHCR_READ_TOKEN` | A token with `read:packages` permission for the GHCR packages. |

### Obtain `AZURE_VM_KNOWN_HOSTS` safely

Run this from a trusted machine and use the same hostname stored in `AZURE_VM_HOST`:

```bash
ssh-keyscan -H hforge.westeurope.cloudapp.azure.com > azure-known-hosts
ssh-keygen -lf azure-known-hosts
```

`ssh-keyscan` only retrieves a presented public key; it does not prove that the key is authentic. Verify the fingerprint independently through the Azure VM console, the VM provisioning record, or an already trusted administrative connection before copying the complete `azure-known-hosts` file into the `AZURE_VM_KNOWN_HOSTS` repository secret. Never disable strict host-key checking to work around a mismatch.

## GHCR setup

The first successful deployment creates the two GHCR packages under the repository owner. Confirm their visibility and access before deploying:

- Public packages can be pulled without a VM token, although the workflow still supports authenticated pulls.
- Private packages require `GHCR_USERNAME` and a `GHCR_READ_TOKEN` with `read:packages` access to the package owner. A classic GitHub personal access token is the compatible choice for this VM pull path.
- Grant the token only the package-read permission needed by the VM, and store it only as the repository secret. Do not add it to `.env`, Compose files, or shell commands.

The production Compose file defaults to the hforge namespace `h5uarez` and to `IMAGE_TAG=latest` when run without an override. The deployment workflow always overrides `IMAGE_TAG` with the selected commit SHA. A different owner or namespace can be supplied through `GHCR_NAMESPACE` in the existing remote `.env`; the workflow's published namespace must match it.

## Data and secret preservation invariant

The VM's `/opt/hforge/.env`, `/opt/hforge/data`, and `/opt/hforge/media` are never uploaded, replaced, or reset by this pipeline. The workflow uploads only `docker-compose.prod.yml`. The production Compose file keeps these bind mounts:

- `./data:/data` for API data.
- `./media/img` and `./media/gif` for persistent exercise media.

The media one-shot service may populate missing media files on first startup, but it does not replace existing files. Keep independent backups of `/opt/hforge/data` and `/opt/hforge/media`.

The current VM has a new hostname-bound passkey store. This pipeline performs no local data migration and does not copy local passkeys or local runtime data to Azure.

## Manual deployment and smoke test

Before the first run, confirm that `/opt/hforge` already contains the production `.env`, `data`, `media/img`, and `media/gif` paths. Then run the workflow manually from the intended commit.

After it succeeds, verify the public endpoint from a trusted client:

```bash
curl --fail --show-error https://hforge.westeurope.cloudapp.azure.com/api/health
```

A successful response contains `"ok":true`.

## Rollback to a previous commit tag

Only roll back to a SHA whose two GHCR images still exist. From a trusted machine, connect to the VM and run:

```bash
ssh <user>@hforge.westeurope.cloudapp.azure.com
cd /opt/hforge
IMAGE_TAG=<known-good-commit-sha> docker compose --env-file .env -f docker-compose.prod.yml pull api web
IMAGE_TAG=<known-good-commit-sha> docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build api web
curl --fail --show-error http://127.0.0.1:8080/api/health
```

Use the same strict `known_hosts` options as the workflow for administrative SSH. The rollback changes only the image tag; it does not restore or migrate data.

## Changing to automatic `main` deployment later

Keep the current manual route until the team is comfortable with the rollback procedure. When automatic deployment is explicitly approved, add a `push` trigger for `main` to `deploy.yml` and keep `workflow_dispatch` for emergency/manual releases:

```yaml
on:
  push:
    branches:
      - main
  workflow_dispatch:
```

Before enabling it, protect a `production` environment with required reviewers, ensure the six secrets are scoped appropriately, and confirm that CI and branch protection prevent unverified changes from reaching `main`.
