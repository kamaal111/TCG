import type { ConfigStore, EnvironmentDocument } from './config.ts';
import type { Prompts } from './prompts.ts';

interface Credential {
  id: string;
  label: string;
  fields: readonly { key: string; label: string }[];
  help: readonly string[];
  next: 'plan' | 'host' | 'bootstrap' | 'docker' | 'release';
  environment?: Readonly<Record<string, string>>;
}

export const credentials: readonly Credential[] = [
  {
    id: 'scrydex',
    label: 'Scrydex API key and team ID',
    fields: [
      { key: 'SCRYDEX_API_KEY', label: 'Scrydex API key' },
      { key: 'SCRYDEX_TEAM_ID', label: 'Scrydex team ID' },
    ],
    environment: { SCRYDEX_CLIENT: 'real' },
    next: 'release',
    help: [
      'Copy the API key and team ID from your Scrydex account.',
      'Live pricing and card images require both values. Static mode uses sample data without real card art.',
      'Values are saved privately and installed by the server setup step in just release-server.',
    ],
  },
  {
    id: 'hcp',
    label: 'HCP Terraform user token',
    fields: [{ key: 'TF_TOKEN_app_terraform_io', label: 'HCP user API token' }],
    next: 'plan',
    help: [
      'Open HCP Terraform → User Settings → Tokens → Create an API token.',
      'Name it tcg-mac-mini, choose an expiration, and save the token in your password manager.',
      'https://app.terraform.io/app/settings/tokens',
    ],
  },
  {
    id: 'digitalocean',
    label: 'DigitalOcean API token',
    fields: [{ key: 'DIGITALOCEAN_TOKEN', label: 'DigitalOcean API token' }],
    next: 'plan',
    help: [
      'Open DigitalOcean → Account → API → Tokens → Generate New Token.',
      'Choose Custom Scopes and an expiration. Use these permissions:',
      'Account: Read. Droplet: Read, Update. Database: Read, Update, View Credentials.',
      'Firewall: Read, Create, Update, Delete. Spaces Key: Read, Create, Create Credentials, Update, Delete.',
      'Tag: Read, Delete. Actions, Image, Regions, Sizes, SSH Key, VPC: Read only.',
      'Tag Delete is required when adoption removes existing resource tags.',
      'Existing token scopes cannot be edited: create a replacement token.',
      'https://docs.digitalocean.com/reference/api/scopes/',
    ],
  },
  {
    id: 'spaces',
    label: 'Spaces administrator key pair',
    fields: [
      { key: 'SPACES_ACCESS_KEY_ID', label: 'Spaces access key ID' },
      { key: 'SPACES_SECRET_ACCESS_KEY', label: 'Spaces secret access key' },
    ],
    next: 'plan',
    help: [
      'Open DigitalOcean → Spaces Object Storage → Access Keys → Create Access Key.',
      'Choose Full access, name it tcg-infrastructure, and save BOTH the access key and secret.',
      'This administrator key creates/configures buckets; it is separate from the application runtime key.',
      'https://docs.digitalocean.com/products/spaces/how-to/manage-access/',
    ],
  },
  {
    id: 'download',
    label: 'GitHub image-download token',
    fields: [{ key: 'TCG_REGISTRY_TOKEN', label: 'GitHub classic token for image downloads' }],
    next: 'host',
    help: [
      'Open GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).',
      'Create tcg-droplet-pull with read:packages and an expiration. Fine-grained tokens do not work with GHCR.',
      'The account must have access to both the server and server-migrations packages.',
      'https://github.com/settings/tokens',
    ],
  },
  {
    id: 'tailscale',
    label: 'Tailscale bootstrap key',
    fields: [{ key: 'TCG_TAILSCALE_AUTH_KEY', label: 'Tailscale server auth key' }],
    next: 'bootstrap',
    help: [
      'Use your existing tailnet. In Access controls, allow administrators to own tag:tcg-server and reach it on TCP 22.',
      'Merge into tagOwners: "tag:tcg-server": ["autogroup:admin"]',
      'Add to grants: { "src": ["autogroup:admin"], "dst": ["tag:tcg-server"], "ip": ["tcp:22"] }',
      'Preserve existing rules. New narrow grants do not override broader existing grants.',
      'Open Settings → Keys → Generate auth key.',
      'Reusable: off. Ephemeral: off. Tags: tag:tcg-server. Pre-approved: on if shown.',
      'Choose an expiration allowing enough time for setup. This key registers the Droplet, not the Mac.',
      'https://login.tailscale.com/admin/settings/keys',
    ],
  },
  {
    id: 'publishing',
    label: 'GitHub publishing token — instructions only',
    fields: [],
    next: 'docker',
    help: [
      'Open GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).',
      'Create tcg-mac-mini-publish with write:packages and an expiration.',
      'Run Docker login manually. At its Password: prompt paste THIS TOKEN, not your GitHub account password.',
      'Docker stores the login. This wizard does not collect or save a publishing token.',
      'https://github.com/settings/tokens/new?scopes=write:packages',
    ],
  },
];

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function credentialNext(credential: Credential, store: ConfigStore): string {
  switch (credential.next) {
    case 'release':
      return `Activate the saved Scrydex settings:\njust release-server --config-dir ${shellQuote(store.paths.configDirectory)}\nAccept the server setup step, then approve deployment to load the new credentials. No manual SSH edits are needed.`;
    case 'plan':
      return `Verify with a fresh plan:\njust --dotenv-path ${shellQuote(store.paths.infrastructure)} infra-plan\nReview the result before applying anything. Keep the old credential until the replacement is verified.`;
    case 'host':
      return `Install the new download token on the Droplet:\njust --dotenv-path ${shellQuote(store.paths.infrastructure)} infra-configure\nThen verify with:\njust --dotenv-path ${shellQuote(store.paths.release)} deployment-check`;
    case 'bootstrap':
      return 'This replacement is used at the next server registration. It does not rotate the identity of a connected machine. Do not disconnect a working server merely to replace its bootstrap key.';
    case 'docker':
      return 'Run manually:\ndocker login ghcr.io --username "$(gh api user --jq .login)"\nPaste the publishing TOKEN into Password:. Continue only after Login Succeeded.';
  }
}

export async function askCredential({
  credential,
  prompts,
  document,
  replace = false,
}: {
  credential: Credential;
  prompts: Prompts;
  document: EnvironmentDocument;
  replace?: boolean;
}): Promise<Record<string, string>> {
  if (
    credential.fields.length &&
    !replace &&
    credential.fields.every(field => Boolean(document.values[field.key])) &&
    (await prompts.confirm(`${credential.label}: configured — keep existing?`))
  ) {
    return { ...credential.environment };
  }

  prompts.note(credential.help.join('\n'), credential.label);
  const changes = { ...credential.environment };

  for (const field of credential.fields) {
    while (true) {
      const value = (await prompts.password(field.label)).trim();

      if (value && !/[\s\0`]/.test(value) && !value.startsWith('github_pat_')) {
        changes[field.key] = value;
        break;
      }

      prompts.note('Paste only the single-line credential. GitHub registry tokens must be classic tokens.');
    }
  }

  return changes;
}
