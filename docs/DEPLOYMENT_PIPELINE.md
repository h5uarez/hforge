# hforge CI/CD pipeline

The repository runs validation CI automatically for pull requests and pushes to `main`, but those events do not deploy anything. GitHub Actions production CD is deliberately manual: it publishes immutable images, authenticates to Azure with OIDC, and deploys through Azure VM Run Command. Render Git auto-deploy is disabled as well, so any Render deployment must be started manually through the platform procedure selected for the service. GitHub-hosted runners never open an SSH connection to the VM, so the VM NSG can keep SSH restricted to the fixed administrator IP.

## Quick path

1. Configure the five repository secrets listed below.
2. Open **Actions → Deploy → Run workflow** from `main` and select the commit to deploy.
3. Confirm that the workflow completes the VM Run Command and the external HTTPS smoke test.

The production endpoint is:

```text
https://hforge.westeurope.cloudapp.azure.com/api/health
```

## CI behavior

`.github/workflows/ci.yml` runs for every pull request and every push to `main`:

- Frontend: Node.js 22, `npm ci`, `npm test`, and `npm run build`.
- API: Node.js 22, `npm ci`, and `node --check server.js`.
- Compose: validates the local Compose file with a temporary CI-only `.env`, then builds the local `api` and `web` services.

The temporary `.env` includes the safe, non-secret `EXERCISE_MEDIA_SOURCE=/tmp/exercise-media` path only to allow Compose interpolation. CI does not start the `media` service and does not require exercise data from the repository. The temporary `.env` exists only during the CI job and is never committed.

## Manual CD behavior

`.github/workflows/deploy.yml` is triggered only by `workflow_dispatch`, and deployments are restricted to `main` to match the Azure federated credential. A push to `main` does not invoke this workflow and does not deploy through GitHub Actions. For the selected commit it:

1. Builds `api` and `web` Docker images.
2. Pushes them to GHCR as `ghcr.io/h5uarez/hforge-api:<commit-sha>` and `ghcr.io/h5uarez/hforge-web:<commit-sha>`.
3. Logs in to Azure with `azure/login@v2` using GitHub OIDC.
4. Creates a temporary, secret-free shell script in the GitHub runner workspace.
5. Calls Azure VM Run Command with the script and four named parameters: the GHCR username, GHCR read token, commit SHA, and an unpadded base64-encoded `docker-compose.prod.yml` payload.
6. The VM validates its production paths, writes only `docker-compose.prod.yml`, logs in to GHCR with `--password-stdin`, stops the legacy OpenGym Compose project without removing volumes, pulls and starts the API and web services at the immutable SHA, derives the published web port, and retries the local health check.
7. After Run Command succeeds, the runner checks the public HTTPS health endpoint.

## Render behavior

The `hforge` service in `render.yaml` sets `autoDeployTrigger: off`. Pushes to `main` therefore do not trigger a Render deployment automatically. Any Render deployment must be initiated manually according to the Render procedure selected for the service.

The deployment call is equivalent to:

```bash
az vm run-command invoke \
  --resource-group hforge-rg \
  --name hforge-vm \
  --command-id RunShellScript \
  --scripts "<temporary-script-content>" \
  --parameters \
    ghcr_username=<GHCR_USERNAME> \
    ghcr_token=<GHCR_READ_TOKEN> \
    image_tag=<COMMIT_SHA> \
    compose_b64=<BASE64_COMPOSE_WITHOUT_PADDING>
```

The workflow does not print the parameter values. The VM script does not echo them, supplies the GHCR token through `docker login --password-stdin`, and logs out of GHCR when it exits. The temporary script is removed by the runner after the command returns. No GitHub Actions step uses `ssh`, `scp`, an SSH agent, or an SSH secret.

## Azure OIDC configuration

OIDC gives the workflow a short-lived Azure token through GitHub's identity provider instead of storing an Azure client secret or private key. Azure accepts it only for the federated credential already provisioned for this repository and branch:

| Azure setting | Provisioned value |
| --- | --- |
| User-assigned managed identity | `hforge-github-deploy` |
| Role | `Virtual Machine Contributor` on resource group `hforge-rg` |
| VM | `hforge-vm` in `westeurope` |
| Federated credential subject | `repo:h5uarez@73789768/hforge@1344218374:ref:refs/heads/main` |

The workflow requires the following GitHub Actions secrets. Enter the exact IDs from the Azure subscription; never enter the managed identity name where an ID is required.

This repository uses GitHub's immutable OIDC subject format, which includes the owner ID (`73789768`) and repository ID (`1344218374`). If the repository is transferred or recreated, update the Azure federated credential from the new GitHub token subject rather than guessing the value.

| Secret | Required value |
| --- | --- |
| `AZURE_CLIENT_ID` | The client/application ID of the user-assigned managed identity `hforge-github-deploy`. |
| `AZURE_TENANT_ID` | The Microsoft Entra tenant/directory ID for the Azure subscription. |
| `AZURE_SUBSCRIPTION_ID` | The Azure subscription ID containing `hforge-rg` and `hforge-vm`. |
| `GHCR_USERNAME` | The GitHub account or machine-user name allowed to pull the private GHCR packages. |
| `GHCR_READ_TOKEN` | A GitHub token with `read:packages` permission for the `h5uarez` GHCR packages. |

The old `AZURE_VM_HOST`, `AZURE_VM_USER`, `AZURE_SSH_PRIVATE_KEY`, and `AZURE_VM_KNOWN_HOSTS` secrets are no longer read by this workflow. They are not needed for GitHub Actions deployment and may be removed from repository secrets after confirming that no other automation uses them. Keep any administrator SSH credentials in trusted administrative tooling for the interactive rollback procedure only.

## GHCR setup

The deployment uses the fixed `h5uarez` GHCR namespace for this repository. Confirm the two packages' visibility and access before deploying:

- Public packages can be pulled without a VM token, although the workflow still supports authenticated pulls.
- Private packages require `GHCR_USERNAME` and `GHCR_READ_TOKEN` with `read:packages` access to the package owner. A classic GitHub personal access token is the compatible choice for this VM pull path.
- Grant the token only the package-read permission needed by the VM. Store it only as the repository secret; do not add it to `.env`, Compose files, or source files.

The production Compose file and deployment workflow both use the fixed `h5uarez` namespace. `GHCR_NAMESPACE` is not a supported remote `.env` override. The Compose file defaults to `IMAGE_TAG=latest` when run without an override, while the deployment workflow always uses the selected full commit SHA.

## VM preservation invariant

The Run Command script performs its preflight checks before writing the Compose file. It requires all of these paths on the VM:

| VM path | Pipeline behavior |
| --- | --- |
| `/opt/hforge/.env` | Validate that it exists; never upload, replace, or reset it. |
| `/opt/hforge/data` | Validate that it exists; never upload, replace, or reset it. |
| `/opt/hforge/media` | Validate that it exists; never upload, replace, or reset it. |
| `/opt/hforge/media/img` | Validate that it exists; never upload, replace, or reset it. |
| `/opt/hforge/media/gif` | Validate that it exists; never upload, replace, or reset it. |
| `/opt/hforge/docker-compose.prod.yml` | The only VM file written by the deployment script. |

The production Compose file keeps these bind mounts:

- `./data:/data` for API data.
- `./media/img` and `./media/gif` for persistent exercise media.

Production media must already be prepared on the VM before deployment. The production Compose file has no media population service: the deploy only mounts `/opt/hforge/media/img` and `/opt/hforge/media/gif` into the web container. It does not upload or copy exercise media or any other local runtime data to Azure. Keep independent backups of `/opt/hforge/data` and `/opt/hforge/media`.

## Manual deployment and smoke test

Before the first run, prepare and confirm that `/opt/hforge` already contains the production `.env`, `data`, `media/img`, and `media/gif` paths and the required exercise media. Then run the workflow manually from `main` and the intended commit. The deployment only mounts those persistent media directories; it does not upload or copy them.

Run Command must complete before the external check starts. After the workflow succeeds, verify the public endpoint from a trusted client:

```bash
curl --fail --show-error https://hforge.westeurope.cloudapp.azure.com/api/health
```

A successful response contains `"ok":true`. The VM's local check uses the published web port from the production Compose configuration rather than assuming a fixed port.

## Rollback to a previous commit tag

Only roll back to a SHA whose two GHCR images still exist. This remains an interactive administrator procedure over SSH from a trusted machine; the GitHub Actions runner does not use this path, and the NSG should continue allowing SSH only from the fixed administrator IP.

```bash
ssh <user>@hforge.westeurope.cloudapp.azure.com
cd /opt/hforge
set -euo pipefail

read -r -p 'GHCR username: ' GHCR_USERNAME
printf '\n'
read -r -s -p 'GHCR read token: ' GHCR_READ_TOKEN
printf '\n'
read -r -p 'Known-good commit SHA: ' IMAGE_TAG
test -n "$IMAGE_TAG"

printf '%s\n' "$GHCR_READ_TOKEN" | sudo docker login ghcr.io \
  --username "$GHCR_USERNAME" \
  --password-stdin >/dev/null
unset GHCR_READ_TOKEN GHCR_USERNAME
trap 'sudo docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

sudo env IMAGE_TAG="$IMAGE_TAG" docker compose --env-file .env -f docker-compose.prod.yml pull api web
sudo env IMAGE_TAG="$IMAGE_TAG" docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build api web
web_port="$(sudo docker compose --env-file .env -f docker-compose.prod.yml port web 80 \
  | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')"
test -n "$web_port"
curl --fail --show-error "http://127.0.0.1:${web_port}/api/health"
sudo docker logout ghcr.io
trap - EXIT
```

The rollback login reads the token silently and never prints or hardcodes it. The derived `web_port` honors the VM's configured `WEB_PORT` value from `.env`; the procedure does not assume `8080`. Logout runs explicitly after the health check and automatically if a rollback command fails. The rollback changes only the image tag; it does not restore or migrate `.env`, data, or media.
