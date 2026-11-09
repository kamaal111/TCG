import { confirmServerSetup } from './server-setup.ts';
import type { Prompts } from '../infra/prompts.ts';

function fixture() {
  return {
    note: vi.fn<Prompts['note']>(),
    confirm: vi.fn<Prompts['confirm']>().mockResolvedValue(false),
    text: vi.fn<Prompts['text']>(),
    password: vi.fn<Prompts['password']>(),
    select: vi.fn<Prompts['select']>(),
    multiselect: vi.fn<Prompts['multiselect']>(),
  };
}

test('the required upgrade explains saved credentials, actual changes and what declining does', async () => {
  const prompts = fixture();
  expect(await confirmServerSetup({ prompts, reason: 'older-tools' })).toBe(false);
  expect(prompts.note).toHaveBeenCalledWith(
    expect.stringContaining('You do not need to enter new credentials'),
    'Update server setup',
  );
  expect(prompts.note).toHaveBeenCalledWith(
    expect.stringContaining('No stops this release attempt and leaves your deployed app running'),
    'Update server setup',
  );
  expect(prompts.note).toHaveBeenCalledWith(
    expect.stringContaining(
      'reapplies saved domain, database/storage settings, deployment SSH access and registry login',
    ),
    'Update server setup',
  );
  expect(prompts.confirm).toHaveBeenCalledWith(
    'Apply saved settings and update deployment scripts on the server?',
    false,
  );
});

test('optional configuration explains why it is offered and that declining continues the release', async () => {
  const prompts = fixture();
  await confirmServerSetup({ prompts, reason: 'changed-settings' });
  expect(prompts.note).toHaveBeenCalledWith(
    expect.stringContaining('Server settings or setup files have changed'),
    'Update server setup',
  );
  expect(prompts.note).toHaveBeenCalledWith(
    expect.stringContaining('No skips this setup step and continues the release'),
    'Update server setup',
  );
});
